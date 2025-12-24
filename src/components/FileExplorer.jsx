import { useState, useEffect, useMemo } from 'react'
import {
    Folder, File, ArrowLeft, RefreshCw, Trash2, Download,
    Home, Eye, FileText, Image, Video, Music, AlertCircle,
    ArrowUpDown, ArrowUp, ArrowDown
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
    const [sortBy, setSortBy] = useState('name') // name, size, date, type
    const [sortOrder, setSortOrder] = useState('asc') // asc, desc

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

    // Sorted files with memoization
    const sortedFiles = useMemo(() => {
        const sorted = [...files]

        sorted.sort((a, b) => {
            // Folders always first
            if (a.isDirectory !== b.isDirectory) {
                return a.isDirectory ? -1 : 1
            }

            let comparison = 0
            switch (sortBy) {
                case 'name':
                    comparison = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
                    break
                case 'size':
                    comparison = (a.size || 0) - (b.size || 0)
                    break
                case 'date':
                    comparison = (a.mtime || 0) - (b.mtime || 0)
                    break
                case 'type':
                    comparison = (a.type || '').localeCompare(b.type || '')
                    if (comparison === 0) comparison = a.name.localeCompare(b.name)
                    break
                default:
                    comparison = a.name.localeCompare(b.name)
            }

            return sortOrder === 'asc' ? comparison : -comparison
        })

        return sorted
    }, [files, sortBy, sortOrder])

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

    const getFileIcon = (file) => {
        const type = file.type || 'file'
        switch (type) {
            case 'image': return <Image size={24} />
            case 'video': return <Video size={24} />
            case 'audio': return <Music size={24} />
            case 'document': return <FileText size={24} />
            default: return <File size={24} />
        }
    }

    const toggleSort = (field) => {
        if (sortBy === field) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
        } else {
            setSortBy(field)
            setSortOrder('asc')
        }
    }

    const SortIcon = ({ field }) => {
        if (sortBy !== field) return <ArrowUpDown size={14} className="sort-icon inactive" />
        return sortOrder === 'asc'
            ? <ArrowUp size={14} className="sort-icon active" />
            : <ArrowDown size={14} className="sort-icon active" />
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
                        {/* Sort Header */}
                        <div className="file-list-header">
                            <div className="header-icon-spacer"></div>
                            <button className="sort-btn name" onClick={() => toggleSort('name')}>
                                Name <SortIcon field="name" />
                            </button>
                            <button className="sort-btn size" onClick={() => toggleSort('size')}>
                                Size <SortIcon field="size" />
                            </button>
                            <button className="sort-btn date" onClick={() => toggleSort('date')}>
                                Modified <SortIcon field="date" />
                            </button>
                            <button className="sort-btn type" onClick={() => toggleSort('type')}>
                                Type <SortIcon field="type" />
                            </button>
                            <span className="actions-header">Actions</span>
                        </div>

                        {sortedFiles.map((file) => (
                            <div
                                key={file.path}
                                className="file-item"
                                onClick={() => file.isDirectory && navigate(file.path)}
                            >
                                <div className={`icon-wrapper ${file.isDirectory ? 'folder' : (file.type || 'file')}`}>
                                    {file.isDirectory ? <Folder size={24} /> : getFileIcon(file)}
                                </div>

                                <span className="file-name">{file.name}</span>

                                <span className="file-size">
                                    {file.sizeFormatted || '—'}
                                </span>

                                <span className="file-date">
                                    {file.mtimeFormatted || '—'}
                                </span>

                                <span className="file-type">
                                    {file.isDirectory ? 'Folder' : (file.type || 'File')}
                                </span>

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
