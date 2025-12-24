import { spawn, exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

// Download job storage
const activeDownloads = new Map();

// Configuration
const CHUNK_SIZE = 50 * 1024 * 1024; // 50MB chunks
const MAX_CONCURRENCY = 4; // 4 parallel ADB processes

class DownloadJob extends EventEmitter {
    constructor(jobId, remotePath, localPath, fileSize) {
        super();
        this.jobId = jobId;
        this.remotePath = remotePath;
        this.localPath = localPath;
        this.fileSize = fileSize;
        this.chunks = [];
        this.completedChunks = 0;
        this.bytesDownloaded = 0;
        this.status = 'pending'; // pending, downloading, merging, completed, error, paused
        this.startTime = null;
        this.speed = 0;
        this.error = null;

        this._initChunks();
    }

    _initChunks() {
        const numChunks = Math.ceil(this.fileSize / CHUNK_SIZE);
        for (let i = 0; i < numChunks; i++) {
            const start = i * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, this.fileSize);
            this.chunks.push({
                index: i,
                start,
                end,
                size: end - start,
                status: 'pending', // pending, downloading, completed, error
                localFile: `${this.localPath}.chunk${i}`
            });
        }
    }

    async start() {
        this.status = 'downloading';
        this.startTime = Date.now();

        const queue = [...this.chunks];
        const activeWorkers = [];

        const processNext = async () => {
            if (queue.length === 0 || this.status === 'paused' || this.status === 'error') {
                return;
            }

            const chunk = queue.shift();
            chunk.status = 'downloading';

            try {
                await this._downloadChunk(chunk);
                chunk.status = 'completed';
                this.completedChunks++;
                this.bytesDownloaded += chunk.size;
                this._updateSpeed();
                this.emit('progress', this.getProgress());

                // Process next chunk
                await processNext();
            } catch (err) {
                chunk.status = 'error';
                this.error = err.message;
                this.status = 'error';
                this.emit('error', err);
            }
        };

        // Start parallel workers
        for (let i = 0; i < MAX_CONCURRENCY && i < this.chunks.length; i++) {
            activeWorkers.push(processNext());
        }

        await Promise.all(activeWorkers);

        if (this.status !== 'error' && this.status !== 'paused') {
            await this._mergeChunks();
            this.status = 'completed';
            this.emit('complete', this.localPath);
        }
    }

    async _downloadChunk(chunk) {
        return new Promise((resolve, reject) => {
            // Use dd to read specific byte range from file
            const escapedPath = this.remotePath.replace(/'/g, "'\"'\"'");
            // dd: skip=bytes, count=bytes with bs=1 is slow. Use larger block size with offset calculation
            const bs = 4096;
            const skipBlocks = Math.floor(chunk.start / bs);
            const countBlocks = Math.ceil(chunk.size / bs);
            const skipBytes = chunk.start % bs;

            // For precision, we'll use a combination approach
            // Read slightly more and trim, or use exact byte mode for smaller chunks
            const cmd = `adb shell "dd if='${escapedPath}' bs=1 skip=${chunk.start} count=${chunk.size} 2>/dev/null" > "${chunk.localFile}"`;

            const child = exec(cmd, { maxBuffer: CHUNK_SIZE * 2 }, (error, stdout, stderr) => {
                if (error && !fs.existsSync(chunk.localFile)) {
                    reject(new Error(`Chunk ${chunk.index} failed: ${stderr}`));
                } else {
                    resolve();
                }
            });
        });
    }

    async _mergeChunks() {
        this.status = 'merging';
        this.emit('progress', this.getProgress());

        const writeStream = fs.createWriteStream(this.localPath);

        for (const chunk of this.chunks) {
            if (fs.existsSync(chunk.localFile)) {
                const data = fs.readFileSync(chunk.localFile);
                writeStream.write(data);
                fs.unlinkSync(chunk.localFile); // Clean up chunk file
            }
        }

        writeStream.end();

        return new Promise((resolve) => {
            writeStream.on('finish', resolve);
        });
    }

    _updateSpeed() {
        const elapsed = (Date.now() - this.startTime) / 1000;
        if (elapsed > 0) {
            this.speed = this.bytesDownloaded / elapsed;
        }
    }

    getProgress() {
        const percent = this.fileSize > 0 ? (this.bytesDownloaded / this.fileSize) * 100 : 0;
        const eta = this.speed > 0 ? (this.fileSize - this.bytesDownloaded) / this.speed : 0;

        return {
            jobId: this.jobId,
            fileName: path.basename(this.remotePath),
            status: this.status,
            bytesDownloaded: this.bytesDownloaded,
            totalBytes: this.fileSize,
            percent: Math.round(percent * 100) / 100,
            speed: this.speed,
            speedFormatted: formatSpeed(this.speed),
            eta: Math.round(eta),
            etaFormatted: formatTime(eta),
            completedChunks: this.completedChunks,
            totalChunks: this.chunks.length,
            error: this.error
        };
    }

    pause() {
        this.status = 'paused';
    }

    cancel() {
        this.status = 'cancelled';
        // Clean up chunk files
        for (const chunk of this.chunks) {
            if (fs.existsSync(chunk.localFile)) {
                fs.unlinkSync(chunk.localFile);
            }
        }
    }
}

function formatSpeed(bytesPerSec) {
    if (bytesPerSec >= 1024 * 1024) {
        return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;
    } else if (bytesPerSec >= 1024) {
        return `${(bytesPerSec / 1024).toFixed(2)} KB/s`;
    }
    return `${Math.round(bytesPerSec)} B/s`;
}

function formatTime(seconds) {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export function createDownloadJob(remotePath, localPath, fileSize) {
    const jobId = `dl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const job = new DownloadJob(jobId, remotePath, localPath, fileSize);
    activeDownloads.set(jobId, job);
    return job;
}

export function getDownloadJob(jobId) {
    return activeDownloads.get(jobId);
}

export function getAllDownloads() {
    return Array.from(activeDownloads.values()).map(job => job.getProgress());
}

export function removeDownloadJob(jobId) {
    const job = activeDownloads.get(jobId);
    if (job) {
        job.cancel();
        activeDownloads.delete(jobId);
    }
}
