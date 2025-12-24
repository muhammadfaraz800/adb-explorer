import { useState, useEffect } from 'react'
import { Download, X, Pause, Play, Check, AlertCircle, Loader } from 'lucide-react'

export default function DownloadManager() {
    const [downloads, setDownloads] = useState([])
    const [isOpen, setIsOpen] = useState(false)

    useEffect(() => {
        // Poll for downloads every 2 seconds
        const fetchDownloads = async () => {
            try {
                const res = await fetch('http://localhost:3001/api/downloads')
                const data = await res.json()
                setDownloads(data)

                // Auto-open if there are active downloads
                if (data.some(d => d.status === 'downloading' || d.status === 'merging')) {
                    setIsOpen(true)
                }
            } catch (e) {
                console.error(e)
            }
        }

        fetchDownloads()
        const interval = setInterval(fetchDownloads, 2000)
        return () => clearInterval(interval)
    }, [])

    const cancelDownload = async (jobId) => {
        try {
            await fetch(`http://localhost:3001/api/download/${jobId}`, { method: 'DELETE' })
            setDownloads(prev => prev.filter(d => d.jobId !== jobId))
        } catch (e) {
            console.error(e)
        }
    }

    const downloadFile = (jobId) => {
        window.open(`http://localhost:3001/api/download/file/${jobId}`, '_blank')
    }

    const getStatusIcon = (status) => {
        switch (status) {
            case 'downloading':
            case 'merging':
                return <Loader size={16} className="spin" />
            case 'completed':
                return <Check size={16} />
            case 'error':
                return <AlertCircle size={16} />
            default:
                return <Download size={16} />
        }
    }

    const activeCount = downloads.filter(d =>
        d.status === 'downloading' || d.status === 'merging'
    ).length

    if (downloads.length === 0) return null

    return (
        <div className="download-manager">
            {/* Toggle Button */}
            <button
                className="download-manager-toggle"
                onClick={() => setIsOpen(!isOpen)}
            >
                <Download size={20} />
                {activeCount > 0 && (
                    <span className="download-badge">{activeCount}</span>
                )}
            </button>

            {/* Panel */}
            {isOpen && (
                <div className="download-panel">
                    <div className="download-panel-header">
                        <span>Downloads</span>
                        <button className="icon-btn" onClick={() => setIsOpen(false)}>
                            <X size={18} />
                        </button>
                    </div>

                    <div className="download-list">
                        {downloads.map(dl => (
                            <div key={dl.jobId} className="download-item">
                                <div className="download-item-info">
                                    <div className="download-item-icon">
                                        {getStatusIcon(dl.status)}
                                    </div>
                                    <div className="download-item-details">
                                        <span className="download-item-name">{dl.fileName}</span>
                                        <span className="download-item-status">
                                            {dl.status === 'downloading' && (
                                                <>
                                                    {dl.percent.toFixed(1)}% • {dl.speedFormatted} • ETA: {dl.etaFormatted}
                                                </>
                                            )}
                                            {dl.status === 'merging' && 'Merging chunks...'}
                                            {dl.status === 'completed' && 'Completed'}
                                            {dl.status === 'error' && `Error: ${dl.error}`}
                                        </span>
                                    </div>
                                </div>

                                {/* Progress bar */}
                                {(dl.status === 'downloading' || dl.status === 'merging') && (
                                    <div className="download-progress">
                                        <div
                                            className="download-progress-bar"
                                            style={{ width: `${dl.percent}%` }}
                                        />
                                    </div>
                                )}

                                {/* Actions */}
                                <div className="download-item-actions">
                                    {dl.status === 'completed' && (
                                        <button
                                            className="action-btn"
                                            onClick={() => downloadFile(dl.jobId)}
                                            title="Save to disk"
                                        >
                                            <Download size={16} />
                                        </button>
                                    )}
                                    <button
                                        className="action-btn delete"
                                        onClick={() => cancelDownload(dl.jobId)}
                                        title="Remove"
                                    >
                                        <X size={16} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}

// Start a download from anywhere
export async function startDownload(filePath) {
    try {
        const res = await fetch('http://localhost:3001/api/download/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath })
        })
        const data = await res.json()
        return data
    } catch (e) {
        console.error('Failed to start download:', e)
        throw e
    }
}
