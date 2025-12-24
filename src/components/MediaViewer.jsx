import { X, ZoomIn, ZoomOut, RotateCw, Download, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'

export default function MediaViewer({ file, onClose, mediaFiles = [], onNavigate, onDelete }) {
    const [zoom, setZoom] = useState(1)
    const [loading, setLoading] = useState(true)
    const videoRef = useRef(null)

    const isImage = /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(file.name)
    const isVideo = /\.(mp4|mkv|webm|avi|mov|m4v)$/i.test(file.name)
    const isAudio = /\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(file.name)
    const isSupported = isImage || isVideo || isAudio

    const mediaUrl = `http://localhost:3001/api/stream?path=${encodeURIComponent(file.path)}`

    // Find current index in media files for navigation
    const currentIndex = mediaFiles.findIndex(f => f.path === file.path)
    const hasPrev = currentIndex > 0
    const hasNext = currentIndex < mediaFiles.length - 1

    const navigatePrev = () => {
        if (hasPrev && onNavigate) {
            setLoading(true)
            onNavigate(mediaFiles[currentIndex - 1])
        }
    }

    const navigateNext = () => {
        if (hasNext && onNavigate) {
            setLoading(true)
            onNavigate(mediaFiles[currentIndex + 1])
        }
    }

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') onClose()
            if (e.key === '+' || e.key === '=') setZoom(z => Math.min(z + 0.25, 5))
            if (e.key === '-') setZoom(z => Math.max(z - 0.25, 0.25))

            // Arrow key handling
            if (e.key === 'ArrowLeft') {
                if (e.ctrlKey && isVideo && videoRef.current) {
                    // CTRL + Left: seek back 5 seconds
                    e.preventDefault()
                    videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 5)
                } else {
                    // Left: navigate to previous media
                    e.preventDefault()
                    navigatePrev()
                }
            }

            if (e.key === 'ArrowRight') {
                if (e.ctrlKey && isVideo && videoRef.current) {
                    // CTRL + Right: seek forward 5 seconds
                    e.preventDefault()
                    videoRef.current.currentTime = Math.min(
                        videoRef.current.duration || 0,
                        videoRef.current.currentTime + 5
                    )
                } else {
                    // Right: navigate to next media
                    e.preventDefault()
                    navigateNext()
                }
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [onClose, isVideo, hasPrev, hasNext, currentIndex])

    const handleDownload = () => {
        window.open(`http://localhost:3001/api/view?path=${encodeURIComponent(file.path)}&download=true`, '_blank')
    }

    const handleDelete = async () => {
        if (!confirm(`Delete "${file.name}"?`)) return

        try {
            const res = await fetch('http://localhost:3001/api/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filePath: file.path })
            })

            if (res.ok) {
                // Notify parent to refresh file list
                if (onDelete) onDelete(file.path)

                // Navigate to next or previous, or close if no more media
                if (hasNext) {
                    onNavigate(mediaFiles[currentIndex + 1])
                } else if (hasPrev) {
                    onNavigate(mediaFiles[currentIndex - 1])
                } else {
                    onClose()
                }
            } else {
                const d = await res.json()
                alert('Failed to delete: ' + d.error)
            }
        } catch (e) {
            alert('Delete failed: ' + e.message)
        }
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
                        <button className="icon-btn delete-btn" onClick={handleDelete} title="Delete">
                            <Trash2 size={20} />
                        </button>
                        <button className="icon-btn close-btn" onClick={onClose} title="Close (Esc)">
                            <X size={24} />
                        </button>
                    </div>
                </div>

                {/* Media Content */}
                <div className="media-viewer-body">
                    {/* Navigation Arrows */}
                    {mediaFiles.length > 1 && (
                        <>
                            <button
                                className={`nav-arrow nav-prev ${!hasPrev ? 'disabled' : ''}`}
                                onClick={(e) => { e.stopPropagation(); navigatePrev(); }}
                                disabled={!hasPrev}
                                title="Previous (←)"
                            >
                                <ChevronLeft size={32} />
                            </button>
                            <button
                                className={`nav-arrow nav-next ${!hasNext ? 'disabled' : ''}`}
                                onClick={(e) => { e.stopPropagation(); navigateNext(); }}
                                disabled={!hasNext}
                                title="Next (→)"
                            >
                                <ChevronRight size={32} />
                            </button>
                        </>
                    )}

                    {/* Only show loading for supported file types */}
                    {loading && isSupported && (
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

                    {!isSupported && (
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
