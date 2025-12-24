import { X, ZoomIn, ZoomOut, RotateCw, Download } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'

export default function MediaViewer({ file, onClose }) {
    const [zoom, setZoom] = useState(1)
    const [loading, setLoading] = useState(true)
    const videoRef = useRef(null)

    const isImage = /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(file.name)
    const isVideo = /\.(mp4|mkv|webm|avi|mov|m4v)$/i.test(file.name)
    const isAudio = /\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(file.name)

    const mediaUrl = `http://localhost:3001/api/stream?path=${encodeURIComponent(file.path)}`

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') onClose()
            if (e.key === '+' || e.key === '=') setZoom(z => Math.min(z + 0.25, 5))
            if (e.key === '-') setZoom(z => Math.max(z - 0.25, 0.25))
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [onClose])

    const handleDownload = () => {
        window.open(`http://localhost:3001/api/view?path=${encodeURIComponent(file.path)}&download=true`, '_blank')
    }

    return (
        <div className="media-viewer-overlay" onClick={onClose}>
            <div className="media-viewer-content" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="media-viewer-header">
                    <span className="media-viewer-title">{file.name}</span>
                    <div className="media-viewer-actions">
                        {isImage && (
                            <>
                                <button className="icon-btn" onClick={() => setZoom(z => Math.max(z - 0.25, 0.25))} title="Zoom Out">
                                    <ZoomOut size={20} />
                                </button>
                                <span className="zoom-level">{Math.round(zoom * 100)}%</span>
                                <button className="icon-btn" onClick={() => setZoom(z => Math.min(z + 0.25, 5))} title="Zoom In">
                                    <ZoomIn size={20} />
                                </button>
                                <button className="icon-btn" onClick={() => setZoom(1)} title="Reset Zoom">
                                    <RotateCw size={20} />
                                </button>
                            </>
                        )}
                        <button className="icon-btn" onClick={handleDownload} title="Download">
                            <Download size={20} />
                        </button>
                        <button className="icon-btn close-btn" onClick={onClose} title="Close (Esc)">
                            <X size={24} />
                        </button>
                    </div>
                </div>

                {/* Media Content */}
                <div className="media-viewer-body">
                    {loading && (
                        <div className="media-loading">
                            <div className="spinner"></div>
                            <p>Loading...</p>
                        </div>
                    )}

                    {isImage && (
                        <img
                            src={mediaUrl}
                            alt={file.name}
                            style={{ transform: `scale(${zoom})`, opacity: loading ? 0 : 1 }}
                            onLoad={() => setLoading(false)}
                            onError={() => setLoading(false)}
                            draggable={false}
                        />
                    )}

                    {isVideo && (
                        <video
                            ref={videoRef}
                            src={mediaUrl}
                            controls
                            autoPlay
                            style={{ opacity: loading ? 0 : 1 }}
                            onLoadedData={() => setLoading(false)}
                            onError={() => setLoading(false)}
                        />
                    )}

                    {isAudio && (
                        <div className="audio-player">
                            <audio
                                src={mediaUrl}
                                controls
                                autoPlay
                                onLoadedData={() => setLoading(false)}
                            />
                        </div>
                    )}

                    {!isImage && !isVideo && !isAudio && (
                        <div className="unsupported-file">
                            <p>Preview not available for this file type</p>
                            <button className="btn btn-primary" onClick={handleDownload}>
                                <Download size={18} /> Download File
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
