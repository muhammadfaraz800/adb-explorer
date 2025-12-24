import { useState, useEffect } from 'react'
import {
    Folder, File, ArrowLeft, RefreshCw, Trash2, Download,
    Home, Eye, FileText, Image, Video, Music, AlertCircle
} from 'lucide-react'
import MediaViewer from './MediaViewer'

export default function FileExplorer() {
    const [path, setPath] = useState('/sdcard')
    const [files, setFiles] = useState([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [history, setHistory] = useState(['/sdcard'])
    const [historyIndex, setHistoryIndex] = useState(0)
    const [viewingFile, setViewingFile] = useState(null)

    const fetchFiles = async (dirPath) => {
        setLoading(true)
        setError(null)
        try {
            const res = await fetch(`http://localhost:3001/api/files?path=${encodeURIComponent(dirPath)}`)
            const data = await res.json()
            if (res.ok) {
                setFiles(data.files || [])
            } else {
                setError(data.error)
                setFiles([])
            }
        } catch (e) {
            setError(e.message)
            setFiles([])
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchFiles(path)
    }, [path])

    const navigate = (newPath) => {
        if (newPath === path) return
        setPath(newPath)
        const newHistory = history.slice(0, historyIndex + 1)
        newHistory.push(newPath)
        setHistory(newHistory)
        setHistoryIndex(newHistory.length - 1)
    }

    const goBack = () => {
        if (historyIndex > 0) {
            setPath(history[historyIndex - 1])
            setHistoryIndex(historyIndex - 1)
        }
    }

    const handleDelete = async (filePath, e) => {
        e.stopPropagation()
        if (!confirm(`Delete "${filePath}"?`)) return

        try {
            const res = await fetch('http://localhost:3001/api/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filePath })
            })
            if (res.ok) {
                fetchFiles(path)
            } else {
                const d = await res.json()
                alert('Failed: ' + d.error)
            }
        } catch (e) {
            alert(e.message)
        }
    }

    const handleDownload = (filePath, e) => {
        e.stopPropagation()
        window.open(`http://localhost:3001/api/view?path=${encodeURIComponent(filePath)}&download=true`, '_blank')
    }

    const handleView = (file, e) => {
        e.stopPropagation()
        setViewingFile(file)
    }

    const getFileType = (name) => {
        const ext = name.split('.').pop().toLowerCase()
        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return 'image'
        if (['mp4', 'mkv', 'webm', 'avi', 'mov', 'm4v'].includes(ext)) return 'video'
        if (['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext)) return 'audio'
        if (['txt', 'log', 'json', 'xml', 'md', 'html', 'css', 'js'].includes(ext)) return 'document'
        return 'file'
    }

    const getFileIcon = (name) => {
        const type = getFileType(name)
        switch (type) {
            case 'image': return <Image size={24} />
            case 'video': return <Video size={24} />
            case 'audio': return <Music size={24} />
            case 'document': return <FileText size={24} />
            default: return <File size={24} />
        }
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Media Viewer Modal */}
            {viewingFile && (
                <MediaViewer
                    file={viewingFile}
                    onClose={() => setViewingFile(null)}
                />
            )}

            {/* Path Bar */}
            <div className="path-bar">
                <div className="path-bar-inner">
                    <button
                        className="icon-btn"
                        onClick={goBack}
                        disabled={historyIndex <= 0}
                        title="Go back"
                    >
                        <ArrowLeft size={20} />
                    </button>

                    <input
                        type="text"
                        value={path}
                        onChange={(e) => setPath(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && fetchFiles(path)}
                        placeholder="Enter path..."
                    />

                    {path !== '/sdcard' && (
                        <button
                            className="icon-btn"
                            onClick={() => navigate('/sdcard')}
                            title="Go to /sdcard"
                        >
                            <Home size={20} />
                        </button>
                    )}

                    <button
                        className="icon-btn"
                        onClick={() => fetchFiles(path)}
                        title="Refresh"
                    >
                        <RefreshCw size={20} className={loading ? 'spin' : ''} />
                    </button>
                </div>
            </div>

            {/* File List */}
            <div className="file-list">
                {error ? (
                    <div className="error-state">
                        <div className="icon">
                            <AlertCircle size={32} />
                        </div>
                        <h3>Error accessing path</h3>
                        <p>{error}</p>
                        <button className="btn btn-primary" onClick={() => navigate('/sdcard')}>
                            Go Home
                        </button>
                    </div>
                ) : (
                    <>
                        <div className="file-list-header">
                            <span>Name</span>
                        </div>

                        {files.map((file) => (
                            <div
                                key={file.path}
                                className="file-item"
                                onClick={() => file.isDirectory && navigate(file.path)}
                            >
                                <div className={`icon-wrapper ${file.isDirectory ? 'folder' : getFileType(file.name)}`}>
                                    {file.isDirectory ? <Folder size={24} /> : getFileIcon(file.name)}
                                </div>

                                <span className="file-name">{file.name}</span>

                                <div className="file-actions">
                                    {!file.isDirectory && (
                                        <>
                                            <button
                                                className="action-btn"
                                                onClick={(e) => handleView(file, e)}
                                                title="View"
                                            >
                                                <Eye size={18} />
                                            </button>
                                            <button
                                                className="action-btn"
                                                onClick={(e) => handleDownload(file.path, e)}
                                                title="Download"
                                            >
                                                <Download size={18} />
                                            </button>
                                        </>
                                    )}
                                    <button
                                        className="action-btn delete"
                                        onClick={(e) => handleDelete(file.path, e)}
                                        title="Delete"
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            </div>
                        ))}

                        {files.length === 0 && !loading && (
                            <div className="empty-state">
                                <div className="icon">
                                    <Folder size={48} />
                                </div>
                                <h3>Empty folder</h3>
                                <p>This directory has no files</p>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    )
}
