import { useState, useEffect, useMemo } from 'react'
import { Trash2, RefreshCw, Video, Image, FileText, Music, Archive, Package, HardDrive, AlertCircle, Eye, Download, Clock } from 'lucide-react'
import MediaViewer from './MediaViewer'

// Helper functions (extracted to avoid re-creation on render)
const formatSize = (bytes) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

const isPreviewable = (type) => {
    return ['image', 'video', 'audio'].includes(type)
}

// Extracted FileSection component to prevent re-mounting and scroll jumps
const FileSection = ({
    title,
    icon,
    files,
    type,
    filesSet,
    toggleSelect,
    selectAllInSection,
    onPreview,
    showDateFilter = false,
    allowEmpty = false,
    oldFilesMonths,
    setOldFilesMonths
}) => {
    if (!allowEmpty && (!files || files.length === 0)) return null

    const sectionTotal = (files || []).reduce((sum, f) => sum + f.size, 0)
    // Check if files exist before trying to check selected status
    const allSelected = files?.length > 0 && files.every(f => filesSet.has(f.path))

    return (
        <div className="cleaner-section">
            <div className="section-header">
                <div className="section-title">
                    <span className={`section-icon ${type}`}>{icon}</span>
                    <h3>{title}</h3>
                    <span className="section-count">{files?.length || 0} files</span>
                    <span className="section-size">{formatSize(sectionTotal)}</span>
                    {showDateFilter && (
                        <select
                            className="age-filter"
                            value={oldFilesMonths}
                            onChange={(e) => setOldFilesMonths(parseInt(e.target.value))}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <option value={1}>1 month</option>
                            <option value={2}>2 months</option>
                            <option value={3}>3 months</option>
                            <option value={4}>4 months</option>
                            <option value={6}>6 months</option>
                            <option value={12}>1 year</option>
                            <option value={24}>2 years</option>
                        </select>
                    )}
                </div>
                {(files?.length > 0) && (
                    <button
                        className="select-all-btn"
                        onClick={() => selectAllInSection(files)}
                    >
                        {allSelected ? 'Deselect All' : 'Select All'}
                    </button>
                )}
            </div>
            <div className="section-files">
                {(!files || files.length === 0) ? (
                    <div className="cleaner-file-item" style={{ cursor: 'default', opacity: 0.7 }}>
                        <span className="file-name" style={{ textAlign: 'center', fontStyle: 'italic' }}>No files found matching this criteria</span>
                    </div>
                ) : (
                    files.map(file => (
                        <div
                            key={file.path}
                            className={`cleaner-file-item ${filesSet.has(file.path) ? 'selected' : ''}`}
                            onClick={(e) => isPreviewable(file.type) ? onPreview(file, e) : toggleSelect(file.path, e)}
                        >
                            <input
                                type="checkbox"
                                checked={filesSet.has(file.path)}
                                onClick={(e) => toggleSelect(file.path, e)}
                                onChange={() => { }}
                            />
                            <span className={`file-icon ${file.type}`}>
                                {file.type === 'video' && <Video size={16} />}
                                {file.type === 'image' && <Image size={16} />}
                                {file.type === 'audio' && <Music size={16} />}
                                {file.type === 'document' && <FileText size={16} />}
                                {file.type === 'archive' && <Archive size={16} />}
                                {file.type === 'app' && <Package size={16} />}
                                {!['video', 'image', 'audio', 'document', 'archive', 'app'].includes(file.type) && <HardDrive size={16} />}
                            </span>
                            <span className="file-name" title={file.path}>{file.name}</span>
                            {showDateFilter && file.mtimeFormatted && (
                                <span className="file-date">{file.mtimeFormatted}</span>
                            )}
                            <span className="file-size">{file.sizeFormatted}</span>
                            {isPreviewable(file.type) && (
                                <button
                                    className="preview-btn"
                                    onClick={(e) => onPreview(file, e)}
                                    title="Preview"
                                >
                                    <Eye size={16} />
                                </button>
                            )}
                            {!isPreviewable(file.type) && (
                                <button
                                    className="download-btn"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        window.open(`http://localhost:3001/api/view?path=${encodeURIComponent(file.path)}&download=true`, '_blank')
                                    }}
                                    title="Download to view"
                                >
                                    <Download size={16} />
                                </button>
                            )}
                        </div>
                    ))
                )}
            </div>
        </div>
    )
}

export default function Cleaner() {
    const [scanning, setScanning] = useState(false)
    const [progress, setProgress] = useState({ scanned: 0, found: 0 })
    const [results, setResults] = useState(null)
    const [error, setError] = useState(null)
    const [selectedFiles, setSelectedFiles] = useState(new Set())
    const [deleting, setDeleting] = useState(false)
    const [viewingFile, setViewingFile] = useState(null)
    const [oldFilesMonths, setOldFilesMonths] = useState(4) // Default 4 months

    const startScan = () => {
        setScanning(true)
        setProgress({ scanned: 0, found: 0 })
        setResults(null)
        setError(null)
        setSelectedFiles(new Set())

        const eventSource = new EventSource('http://localhost:3001/api/scan-large-files?limit=15')

        eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data)

            if (data.type === 'progress') {
                setProgress({ scanned: data.scanned, found: data.found })
            } else if (data.type === 'complete') {
                setResults(data.results)
                setScanning(false)
                eventSource.close()
            }
        }

        eventSource.onerror = () => {
            setError('Scan failed. Make sure device is connected.')
            setScanning(false)
            eventSource.close()
        }
    }

    // Remove deleted files from results without rescanning
    const removeFilesFromResults = (deletedPaths) => {
        if (!results) return

        const pathSet = new Set(deletedPaths)
        const filterFiles = (files) => files?.filter(f => !pathSet.has(f.path)) || []

        setResults(prev => ({
            ...prev,
            all: filterFiles(prev.all),
            videos: filterFiles(prev.videos),
            images: filterFiles(prev.images),
            documents: filterFiles(prev.documents),
            audio: filterFiles(prev.audio),
            archives: filterFiles(prev.archives),
            apps: filterFiles(prev.apps),
            totalScanned: prev.totalScanned - deletedPaths.length,
            totalSize: prev.totalSize - [...deletedPaths].reduce((sum, path) => {
                const file = prev.all?.find(f => f.path === path)
                return sum + (file?.size || 0)
            }, 0)
        }))
    }

    const toggleSelect = (path, e) => {
        e.stopPropagation()
        setSelectedFiles(prev => {
            const next = new Set(prev)
            if (next.has(path)) {
                next.delete(path)
            } else {
                next.add(path)
            }
            return next
        })
    }

    const selectAllInSection = (files) => {
        setSelectedFiles(prev => {
            const next = new Set(prev)
            const allSelected = files.every(f => prev.has(f.path))
            files.forEach(f => {
                if (allSelected) {
                    next.delete(f.path)
                } else {
                    next.add(f.path)
                }
            })
            return next
        })
    }

    const deleteSelected = async () => {
        if (selectedFiles.size === 0) return
        if (!confirm(`Delete ${selectedFiles.size} selected files? This cannot be undone.`)) return

        setDeleting(true)
        const deletedPaths = []

        for (const filePath of selectedFiles) {
            try {
                const res = await fetch('http://localhost:3001/api/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filePath })
                })
                if (res.ok) deletedPaths.push(filePath)
            } catch (e) {
                console.error('Delete failed:', filePath, e)
            }
        }

        setDeleting(false)
        setSelectedFiles(new Set())

        // Remove deleted files from results instead of rescanning
        if (deletedPaths.length > 0) {
            removeFilesFromResults(deletedPaths)
        }

        alert(`Deleted ${deletedPaths.length} of ${selectedFiles.size} files.`)
    }

    // Delete single file from viewer
    const handleDeleteFromViewer = (filePath) => {
        removeFilesFromResults([filePath])
    }

    // Get all media files for navigation in viewer
    const getAllMediaFiles = () => {
        if (!results) return []
        const allFiles = [
            ...(results.videos || []),
            ...(results.images || []),
            ...(results.audio || [])
        ]
        return allFiles.sort((a, b) => b.size - a.size)
    }

    // Calculate old files based on selected months
    const oldFiles = useMemo(() => {
        if (!results?.all) return []
        const cutoffDate = Date.now() - (oldFilesMonths * 30 * 24 * 60 * 60 * 1000)
        return results.all
            .filter(f => f.mtime && f.mtime < cutoffDate)
            .sort((a, b) => a.mtime - b.mtime) // Oldest first
            .slice(0, 15)
    }, [results, oldFilesMonths])

    const handlePreview = (file, e) => {
        e.stopPropagation()
        setViewingFile(file)
    }

    return (
        <div className="cleaner-container">
            {/* Media Viewer Modal */}
            {viewingFile && (
                <MediaViewer
                    file={viewingFile}
                    onClose={() => setViewingFile(null)}
                    mediaFiles={getAllMediaFiles()}
                    onNavigate={(file) => setViewingFile(file)}
                    onDelete={handleDeleteFromViewer}
                />
            )}

            {/* Header */}
            <div className="cleaner-header">
                <div className="cleaner-title">
                    <Trash2 size={24} />
                    <h2>Storage Cleaner</h2>
                </div>
                <p>Find and remove large files to free up space on your device.</p>
            </div>

            {/* Actions */}
            <div className="cleaner-actions">
                <button
                    className="btn btn-primary"
                    onClick={startScan}
                    disabled={scanning}
                >
                    <RefreshCw size={18} className={scanning ? 'spin' : ''} />
                    {scanning ? 'Scanning...' : 'Scan Device'}
                </button>

                {selectedFiles.size > 0 && (
                    <button
                        className="btn btn-danger"
                        onClick={deleteSelected}
                        disabled={deleting}
                    >
                        <Trash2 size={18} />
                        {deleting ? 'Deleting...' : `Delete ${selectedFiles.size} Selected`}
                    </button>
                )}
            </div>

            {/* Progress */}
            {scanning && (
                <div className="scan-progress">
                    <div className="spinner"></div>
                    <p>Scanning device... {progress.scanned} folders scanned, {progress.found} files found</p>
                </div>
            )}

            {/* Error */}
            {error && (
                <div className="cleaner-error">
                    <AlertCircle size={20} />
                    <span>{error}</span>
                </div>
            )}

            {/* Results */}
            {results && !scanning && (
                <div className="cleaner-results">
                    {/* Summary */}
                    <div className="scan-summary">
                        <div className="summary-stat">
                            <span className="stat-value">{results.totalScanned}</span>
                            <span className="stat-label">Files Scanned</span>
                        </div>
                        <div className="summary-stat">
                            <span className="stat-value">{formatSize(results.totalSize)}</span>
                            <span className="stat-label">Total Size</span>
                        </div>
                    </div>

                    {/* Sections */}
                    <FileSection
                        title="Largest Files"
                        icon={<HardDrive size={20} />}
                        files={results.all}
                        type="all"
                        filesSet={selectedFiles}
                        toggleSelect={toggleSelect}
                        selectAllInSection={selectAllInSection}
                        onPreview={handlePreview}
                    />

                    {/* Old Files Section */}
                    <FileSection
                        title={`Old Files (${oldFilesMonths}+ months)`}
                        icon={<Clock size={20} />}
                        files={oldFiles}
                        type="old"
                        filesSet={selectedFiles}
                        toggleSelect={toggleSelect}
                        selectAllInSection={selectAllInSection}
                        onPreview={handlePreview}
                        showDateFilter={true}
                        allowEmpty={true}
                        oldFilesMonths={oldFilesMonths}
                        setOldFilesMonths={setOldFilesMonths}
                    />

                    <FileSection
                        title="Videos"
                        icon={<Video size={20} />}
                        files={results.videos}
                        type="video"
                        filesSet={selectedFiles}
                        toggleSelect={toggleSelect}
                        selectAllInSection={selectAllInSection}
                        onPreview={handlePreview}
                    />
                    <FileSection
                        title="Images"
                        icon={<Image size={20} />}
                        files={results.images}
                        type="image"
                        filesSet={selectedFiles}
                        toggleSelect={toggleSelect}
                        selectAllInSection={selectAllInSection}
                        onPreview={handlePreview}
                    />
                    <FileSection
                        title="Documents"
                        icon={<FileText size={20} />}
                        files={results.documents}
                        type="document"
                        filesSet={selectedFiles}
                        toggleSelect={toggleSelect}
                        selectAllInSection={selectAllInSection}
                        onPreview={handlePreview}
                    />
                    <FileSection
                        title="Audio"
                        icon={<Music size={20} />}
                        files={results.audio}
                        type="audio"
                        filesSet={selectedFiles}
                        toggleSelect={toggleSelect}
                        selectAllInSection={selectAllInSection}
                        onPreview={handlePreview}
                    />
                    <FileSection
                        title="Archives"
                        icon={<Archive size={20} />}
                        files={results.archives}
                        type="archive"
                        filesSet={selectedFiles}
                        toggleSelect={toggleSelect}
                        selectAllInSection={selectAllInSection}
                        onPreview={handlePreview}
                    />
                    <FileSection
                        title="Apps (APKs)"
                        icon={<Package size={20} />}
                        files={results.apps}
                        type="app"
                        filesSet={selectedFiles}
                        toggleSelect={toggleSelect}
                        selectAllInSection={selectAllInSection}
                        onPreview={handlePreview}
                    />
                </div>
            )}

            {/* Initial State */}
            {!results && !scanning && !error && (
                <div className="cleaner-empty">
                    <div className="empty-icon">
                        <HardDrive size={48} />
                    </div>
                    <h3>Scan Your Device</h3>
                    <p>Click "Scan Device" to find large files that can be deleted to free up storage space.</p>
                </div>
            )}
        </div>
    )
}
