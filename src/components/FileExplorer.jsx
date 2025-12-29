import { useState, useEffect, useMemo } from 'react'
import {
    Folder, File, ArrowLeft, RefreshCw, Trash2, Download,
    Home, Eye, EyeOff, FileText, Image, Video, Music, AlertCircle,
    ArrowUpDown, ArrowUp, ArrowDown, Square, CheckSquare, X,
    Upload, FolderPlus
} from 'lucide-react'
import MediaViewer from './MediaViewer'
import UploadModal from './UploadModal'

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
    const [selectedPaths, setSelectedPaths] = useState(new Set()) // Multi-select
    const [showHidden, setShowHidden] = useState(false) // Show/hide hidden files
    const [showUploadModal, setShowUploadModal] = useState(false)
    const [showNewFolderDialog, setShowNewFolderDialog] = useState(false)
    const [newFolderName, setNewFolderName] = useState('')

    const fetchFiles = async (dirPath) => {
        setLoading(true)
        setError(null)
        try {
            const res = await fetch(`http://localhost:3001/api/files?path=${encodeURIComponent(dirPath)}`)
            const data = await res.json()
            if (res.ok) {
                setFiles(data.files || [])

                // Start background folder size calculation
                const folders = (data.files || []).filter(f => f.isDirectory).map(f => f.path)
                if (folders.length > 0) {
                    fetchFolderSizes(folders)
                }
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

    // Fetch folder sizes in background via SSE
    const fetchFolderSizes = (folders) => {
        const url = `http://localhost:3001/api/folder-sizes?folders=${encodeURIComponent(JSON.stringify(folders))}`
        const eventSource = new EventSource(url)

        eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data)

            if (data.done) {
                eventSource.close()
                return
            }

            // Update the specific folder's size
            setFiles(prev => prev.map(file =>
                file.path === data.path
                    ? { ...file, size: data.size, sizeFormatted: data.sizeFormatted }
                    : file
            ))
        }

        eventSource.onerror = () => {
            eventSource.close()
        }
    }

    useEffect(() => {
        fetchFiles(path)
        setSelectedPaths(new Set()) // Clear selection on path change
    }, [path])

    // Sorted and filtered files with memoization
    const sortedFiles = useMemo(() => {
        // Filter hidden files if showHidden is false
        const filtered = showHidden ? files : files.filter(f => !f.name.startsWith('.'))
        const sorted = [...filtered]

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
    }, [files, sortBy, sortOrder, showHidden])

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

    // Selection handlers
    const toggleSelect = (filePath, e) => {
        e.stopPropagation()
        setSelectedPaths(prev => {
            const next = new Set(prev)
            if (next.has(filePath)) {
                next.delete(filePath)
            } else {
                next.add(filePath)
            }
            return next
        })
    }

    const selectAll = () => {
        if (selectedPaths.size === sortedFiles.length) {
            setSelectedPaths(new Set())
        } else {
            setSelectedPaths(new Set(sortedFiles.map(f => f.path)))
        }
    }

    const clearSelection = () => setSelectedPaths(new Set())

    const handleBulkDelete = async () => {
        if (selectedPaths.size === 0) return
        if (!confirm(`Delete ${selectedPaths.size} selected items?`)) return

        for (const filePath of selectedPaths) {
            try {
                await fetch('http://localhost:3001/api/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filePath })
                })
            } catch (e) {
                console.error('Delete failed:', filePath, e)
            }
        }
        setSelectedPaths(new Set())
        fetchFiles(path)
    }

    const handleBulkDownload = () => {
        // Download each selected file (only files, not directories)
        const filesToDownload = sortedFiles.filter(f => selectedPaths.has(f.path) && !f.isDirectory)
        filesToDownload.forEach(file => {
            window.open(`http://localhost:3001/api/view?path=${encodeURIComponent(file.path)}&download=true`, '_blank')
        })
    }

    // Create new folder
    const handleCreateFolder = async () => {
        if (!newFolderName.trim()) return

        const folderPath = path === '/' ? `/${newFolderName}` : `${path}/${newFolderName}`

        try {
            const res = await fetch('http://localhost:3001/api/mkdir', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folderPath })
            })

            if (res.ok) {
                setNewFolderName('')
                setShowNewFolderDialog(false)
                fetchFiles(path)
            } else {
                const data = await res.json()
                alert('Failed: ' + data.error)
            }
        } catch (e) {
            alert(e.message)
        }
    }

    // Get list of media files for navigation in viewer
    const mediaFiles = useMemo(() => {
        return sortedFiles.filter(f => !f.isDirectory && /\.(jpg|jpeg|png|gif|webp|svg|bmp|mp4|mkv|webm|avi|mov|m4v|mp3|wav|ogg|flac|m4a|aac)$/i.test(f.name))
    }, [sortedFiles])

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Media Viewer Modal */}
            {viewingFile && (
                <MediaViewer
                    file={viewingFile}
                    onClose={() => setViewingFile(null)}
                    mediaFiles={mediaFiles}
                    onNavigate={(file) => setViewingFile(file)}
                    onDelete={() => fetchFiles(path)}
                />
            )}

            {/* Upload Modal */}
            {showUploadModal && (
                <UploadModal
                    targetPath={path}
                    onClose={() => setShowUploadModal(false)}
                    onUploadComplete={() => fetchFiles(path)}
                />
            )}

            {/* New Folder Dialog */}
            {showNewFolderDialog && (
                <div className="new-folder-overlay" onClick={() => setShowNewFolderDialog(false)}>
                    <div className="new-folder-dialog" onClick={e => e.stopPropagation()}>
                        <h3><FolderPlus size={20} /> New Folder</h3>
                        <input
                            type="text"
                            value={newFolderName}
                            onChange={(e) => setNewFolderName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
                            placeholder="Folder name..."
                            autoFocus
                        />
                        <div className="new-folder-actions">
                            <button className="btn btn-secondary" onClick={() => setShowNewFolderDialog(false)}>
                                Cancel
                            </button>
                            <button className="btn btn-primary" onClick={handleCreateFolder} disabled={!newFolderName.trim()}>
                                Create
                            </button>
                        </div>
                    </div>
                </div>
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

                    <button
                        className="icon-btn"
                        onClick={() => navigate('/sdcard')}
                        disabled={path === '/sdcard'}
                        title="Go to /sdcard"
                    >
                        <Home size={20} />
                    </button>

                    <button
                        className="icon-btn"
                        onClick={() => fetchFiles(path)}
                        title="Refresh"
                    >
                        <RefreshCw size={20} className={loading ? 'spin' : ''} />
                    </button>

                    <button
                        className={`icon-btn ${showHidden ? 'active' : ''}`}
                        onClick={() => setShowHidden(!showHidden)}
                        title={showHidden ? 'Hide hidden files' : 'Show hidden files'}
                    >
                        {showHidden ? <Eye size={20} /> : <EyeOff size={20} />}
                    </button>

                    <div className="path-bar-divider"></div>

                    <button
                        className="icon-btn"
                        onClick={() => setShowNewFolderDialog(true)}
                        title="New Folder"
                    >
                        <FolderPlus size={20} />
                    </button>

                    <button
                        className="icon-btn upload-btn"
                        onClick={() => setShowUploadModal(true)}
                        title="Upload Files"
                    >
                        <Upload size={20} />
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
                        {/* Selection Action Bar */}
                        {selectedPaths.size > 0 && (
                            <div className="selection-bar">
                                <span className="selection-count">
                                    {selectedPaths.size} selected
                                </span>
                                <button className="selection-action" onClick={handleBulkDownload} title="Download selected files">
                                    <Download size={18} /> Download
                                </button>
                                <button className="selection-action delete" onClick={handleBulkDelete} title="Delete selected">
                                    <Trash2 size={18} /> Delete
                                </button>
                                <button className="selection-action cancel" onClick={clearSelection} title="Clear selection">
                                    <X size={18} />
                                </button>
                            </div>
                        )}

                        {/* Sort Header */}
                        <div className="file-list-header">
                            <button className="select-checkbox" onClick={selectAll} title="Select all">
                                {selectedPaths.size === sortedFiles.length && sortedFiles.length > 0
                                    ? <CheckSquare size={20} />
                                    : <Square size={20} />}
                            </button>
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

                        {sortedFiles.map((file) => {
                            const isMedia = !file.isDirectory && ['image', 'video', 'audio'].includes(file.type)
                            return (
                                <div
                                    key={file.path}
                                    className={`file-item ${selectedPaths.has(file.path) ? 'selected' : ''}`}
                                    onClick={() => {
                                        if (file.isDirectory) {
                                            navigate(file.path)
                                        } else if (isMedia) {
                                            setViewingFile(file)
                                        }
                                    }}
                                >
                                    <button
                                        className="select-checkbox"
                                        onClick={(e) => toggleSelect(file.path, e)}
                                    >
                                        {selectedPaths.has(file.path)
                                            ? <CheckSquare size={20} />
                                            : <Square size={20} />}
                                    </button>
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
                            )
                        })}


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
