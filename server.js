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

// Format bytes to human-readable string
const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

// Cache for folder sizes: { path: { mtime, size, sizeFormatted } }
const folderSizeCache = new Map();

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

// List files with metadata
app.get('/api/files', async (req, res) => {
    const dirPath = req.query.path || '/sdcard';
    // Ensure trailing slash to list directory contents (not symlink itself)
    const pathWithSlash = dirPath.endsWith('/') ? dirPath : dirPath + '/';
    const escapedPath = escapeShellPath(pathWithSlash);

    // Use ls -la to get file details (works reliably on Windows+ADB)
    const { stdout, stderr, error } = await runAdb(`shell ls -la ${escapedPath}`);

    if (error && (stderr.includes('No such file') || stderr.includes('not found') || stderr.includes('No such directory'))) {
        return res.status(404).json({ error: 'Path not found' });
    }

    // Parse ls -la output
    // Format: drwxrwxr-x  2 root sdcard_rw  4096 2024-01-15 10:30 filename
    // Or:     -rw-rw----  1 root sdcard_rw 12345 2024-01-15 10:30 filename
    const lines = stdout.split(/[\r\n]+/).filter(Boolean);
    const files = [];

    for (const line of lines) {
        // Skip total line and parent directory entries
        if (line.startsWith('total') || line.trim() === '') continue;

        // Parse ls -la format: permissions links owner group size date time name
        // Handle filenames with spaces by taking everything after the 7th field
        const parts = line.split(/\s+/);
        if (parts.length < 8) continue;

        const permissions = parts[0];
        const size = parseInt(parts[4], 10) || 0;
        const dateStr = parts[5]; // YYYY-MM-DD
        const timeStr = parts[6]; // HH:MM
        const name = parts.slice(7).join(' '); // Handle names with spaces

        // Skip . and .. entries
        if (name === '.' || name === '..') continue;

        const isDirectory = permissions.startsWith('d');
        const isLink = permissions.startsWith('l');
        const ext = name.includes('.') && !isDirectory ? name.split('.').pop().toLowerCase() : '';

        // Parse date/time
        let mtime = 0;
        try {
            mtime = new Date(`${dateStr}T${timeStr}:00`).getTime();
        } catch (e) {
            mtime = Date.now();
        }

        // Handle symlinks (name contains " -> target")
        const displayName = isLink ? name.split(' -> ')[0] : name;

        files.push({
            name: displayName,
            isDirectory,
            isLink,
            path: dirPath === '/' ? `/${displayName}` : `${dirPath}/${displayName}`,
            size,
            sizeFormatted: formatBytes(size),
            mtime,
            mtimeFormatted: new Date(mtime).toLocaleString(),
            type: isDirectory ? 'folder' : getFileCategory(ext),
            extension: ext
        });
    }

    // Calculate actual directory sizes using du -s (with caching)
    const directories = files.filter(f => f.isDirectory);

    // Check cache first - only calculate sizes for folders with changed mtime
    const needsCalculation = [];
    for (const dir of directories) {
        const cached = folderSizeCache.get(dir.path);
        if (cached && cached.mtime === dir.mtime) {
            // Use cached size
            dir.size = cached.size;
            dir.sizeFormatted = cached.sizeFormatted;
        } else {
            needsCalculation.push(dir);
        }
    }

    // Calculate sizes only for folders that need it (in parallel, max 5 at a time)
    const chunkSize = 5;
    for (let i = 0; i < needsCalculation.length; i += chunkSize) {
        const chunk = needsCalculation.slice(i, i + chunkSize);
        await Promise.all(chunk.map(async (dir) => {
            try {
                const escapedDirPath = escapeShellPath(dir.path);
                const { stdout: duOut } = await runAdb(`shell du -s ${escapedDirPath}`);
                // du -s output: "12345\t/path/to/dir" (size in KB)
                const match = duOut.match(/^(\d+)/);
                if (match) {
                    const sizeKB = parseInt(match[1], 10);
                    dir.size = sizeKB * 1024; // Convert KB to bytes
                    dir.sizeFormatted = formatBytes(dir.size);
                    // Cache the result
                    folderSizeCache.set(dir.path, {
                        mtime: dir.mtime,
                        size: dir.size,
                        sizeFormatted: dir.sizeFormatted
                    });
                }
            } catch (e) {
                // Keep original size if du fails
            }
        }));
    }

    // Default sort: folders first, then by name
    files.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
    });

    res.json({ path: dirPath, files });
});

// Helper to categorize files
function getFileCategory(ext) {
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image';
    if (['mp4', 'mkv', 'webm', 'avi', 'mov', 'm4v'].includes(ext)) return 'video';
    if (['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'].includes(ext)) return 'audio';
    if (['txt', 'log', 'json', 'xml', 'md', 'html', 'css', 'js'].includes(ext)) return 'document';
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'archive';
    if (['apk'].includes(ext)) return 'app';
    if (['pdf'].includes(ext)) return 'pdf';
    return 'file';
}

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
