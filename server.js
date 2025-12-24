import express from 'express';
import cors from 'cors';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createDownloadJob, getDownloadJob, getAllDownloads, removeDownloadJob } from './downloadManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3001;

// Escape path for Android shell (inside adb shell command)
// Use single quotes and escape any existing single quotes in the path
const escapeShellPath = (p) => {
    // Replace single quotes with escaped version: 'text'"'"'more'
    // This closes the single quote, adds an escaped single quote, reopens single quote
    return `'${p.replace(/'/g, "'\"'\"'")}'`;
};

// Helper to run ADB commands
const runAdb = (command) => {
    return new Promise((resolve) => {
        console.log(`Executing: adb ${command}`);
        exec(`adb ${command}`, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
            if (error) {
                console.warn(`ADB Error:`, stderr);
            }
            resolve({ stdout: stdout || '', stderr: stderr || '', error });
        });
    });
};

// Check connection
app.get('/api/status', async (req, res) => {
    const { stdout } = await runAdb('devices');
    const lines = stdout.split('\n').slice(1).filter(line => line.trim().length > 0);

    let status = 'DISCONNECTED';

    if (lines.length > 0) {
        const hasUnauthorized = lines.some(line => line.includes('unauthorized'));
        const hasConnected = lines.some(line => line.includes('device') && !line.includes('devices'));

        if (hasConnected) {
            status = 'CONNECTED';
        } else if (hasUnauthorized) {
            status = 'UNAUTHORIZED';
        }
    }

    res.json({ status, raw: stdout });
});

// Force connect / restart adb server
app.post('/api/connect', async (req, res) => {
    await runAdb('start-server');
    const { stdout } = await runAdb('devices');
    res.json({ stdout });
});

// List files
app.get('/api/files', async (req, res) => {
    const dirPath = req.query.path || '/sdcard';

    // Use single-quote escaping for the Android shell
    const escapedPath = escapeShellPath(dirPath);
    const { stdout, stderr, error } = await runAdb(`shell ls -1p ${escapedPath}`);

    if (error && (stderr.includes('No such file') || stderr.includes('not found') || stderr.includes('No such directory'))) {
        return res.status(404).json({ error: 'Path not found' });
    }

    // Parse output
    const lines = stdout.split(/[\r\n]+/).filter(Boolean);
    const files = lines.map(name => {
        const isDirectory = name.endsWith('/');
        const cleanName = isDirectory ? name.slice(0, -1) : name;
        return {
            name: cleanName,
            isDirectory,
            path: dirPath === '/' ? `/${cleanName}` : `${dirPath}/${cleanName}`
        };
    });

    // Sort: Dirs first, then files
    files.sort((a, b) => {
        if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name);
        return a.isDirectory ? -1 : 1;
    });

    res.json({ path: dirPath, files });
});

// Delete file/dir
app.post('/api/delete', async (req, res) => {
    const { filePath } = req.body;
    if (!filePath) return res.status(400).json({ error: 'No path provided' });

    if (filePath === '/' || filePath === '/sdcard') {
        return res.status(403).json({ error: 'Cannot delete root or sdcard' });
    }

    const escapedPath = escapeShellPath(filePath);
    const { stdout, stderr, error } = await runAdb(`shell rm -rf ${escapedPath}`);

    if (error && stderr) {
        return res.status(500).json({ error: stderr });
    }
    res.json({ success: true, stdout });
});

// View/Download file
app.get('/api/view', async (req, res) => {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).send('No path');

    const fileName = path.posix.basename(filePath);
    const tempDir = path.join(__dirname, 'temp_downloads');

    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    // Sanitize local filename to avoid issues
    const safeFileName = fileName.replace(/[<>:"/\\|?*]/g, '_');
    const localPath = path.join(tempDir, safeFileName);

    // For adb pull, we need to quote the remote path properly
    // adb pull uses different quoting - just use double quotes for the remote path
    const { error, stderr } = await runAdb(`pull "${filePath}" "${localPath}"`);

    if (error) {
        return res.status(500).send(`Failed to pull file: ${stderr}`);
    }

    const download = req.query.download === 'true';
    if (download) {
        res.download(localPath, fileName);
    } else {
        res.sendFile(localPath);
    }
});

// Get file info (size, type)
app.get('/api/fileinfo', async (req, res) => {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'No path' });

    const escapedPath = escapeShellPath(filePath);
    const { stdout, stderr, error } = await runAdb(`shell stat -c "%s" ${escapedPath}`);

    if (error || !stdout.trim()) {
        return res.status(404).json({ error: 'File not found' });
    }

    const size = parseInt(stdout.trim(), 10);
    const ext = path.extname(filePath).toLowerCase();

    res.json({
        path: filePath,
        size,
        sizeFormatted: formatBytes(size),
        extension: ext
    });
});

// Stream file for viewing (pulls then streams)
app.get('/api/stream', async (req, res) => {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).send('No path');

    const fileName = path.posix.basename(filePath);
    const tempDir = path.join(__dirname, 'temp_downloads');

    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const safeFileName = fileName.replace(/[<>:"/\\|?*]/g, '_');
    const localPath = path.join(tempDir, safeFileName);

    // Check if already cached
    if (!fs.existsSync(localPath)) {
        const { error, stderr } = await runAdb(`pull "${filePath}" "${localPath}"`);
        if (error) {
            return res.status(500).send(`Failed: ${stderr}`);
        }
    }

    // Get MIME type
    const ext = path.extname(fileName).toLowerCase();
    const mimeTypes = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
        '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
        '.avi': 'video/x-msvideo', '.mov': 'video/quicktime', '.m4v': 'video/mp4',
        '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
        '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac'
    };

    const contentType = mimeTypes[ext] || 'application/octet-stream';
    const stat = fs.statSync(localPath);

    // Support range requests for video streaming
    const range = req.headers.range;
    if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        const chunkSize = (end - start) + 1;

        res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize,
            'Content-Type': contentType
        });

        fs.createReadStream(localPath, { start, end }).pipe(res);
    } else {
        res.writeHead(200, {
            'Content-Length': stat.size,
            'Content-Type': contentType
        });
        fs.createReadStream(localPath).pipe(res);
    }
});

// Helper to format bytes
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// === PARALLEL CHUNK DOWNLOAD ENDPOINTS ===

// Start a chunked download
app.post('/api/download/start', async (req, res) => {
    const { filePath } = req.body;
    if (!filePath) return res.status(400).json({ error: 'No path' });

    // Get file size first
    const escapedPath = escapeShellPath(filePath);
    const { stdout, error } = await runAdb(`shell stat -c "%s" ${escapedPath}`);

    if (error || !stdout.trim()) {
        return res.status(404).json({ error: 'File not found' });
    }

    const fileSize = parseInt(stdout.trim(), 10);
    const fileName = path.posix.basename(filePath).replace(/[<>:"/\\|?*]/g, '_');
    const tempDir = path.join(__dirname, 'downloads');

    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const localPath = path.join(tempDir, fileName);
    const job = createDownloadJob(filePath, localPath, fileSize);

    // Start download in background
    job.start().catch(err => console.error('Download error:', err));

    res.json({
        jobId: job.jobId,
        fileName,
        fileSize,
        fileSizeFormatted: formatBytes(fileSize)
    });
});

// Get download progress (SSE)
app.get('/api/download/progress/:jobId', (req, res) => {
    const job = getDownloadJob(req.params.jobId);
    if (!job) {
        return res.status(404).json({ error: 'Job not found' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendProgress = () => {
        res.write(`data: ${JSON.stringify(job.getProgress())}\n\n`);
    };

    // Send initial progress
    sendProgress();

    // Listen for updates
    job.on('progress', sendProgress);
    job.on('complete', () => {
        sendProgress();
        res.end();
    });
    job.on('error', () => {
        sendProgress();
        res.end();
    });

    req.on('close', () => {
        job.removeListener('progress', sendProgress);
    });
});

// Get all active downloads
app.get('/api/downloads', (req, res) => {
    res.json(getAllDownloads());
});

// Cancel download
app.delete('/api/download/:jobId', (req, res) => {
    removeDownloadJob(req.params.jobId);
    res.json({ success: true });
});

// Serve downloaded file
app.get('/api/download/file/:jobId', (req, res) => {
    const job = getDownloadJob(req.params.jobId);
    if (!job || job.status !== 'completed') {
        return res.status(404).json({ error: 'Download not ready' });
    }
    res.download(job.localPath, path.basename(job.remotePath));
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
