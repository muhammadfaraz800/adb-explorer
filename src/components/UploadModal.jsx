import { useState, useRef, useCallback } from 'react'
import { Upload, X, File, Folder, CheckCircle, AlertCircle, Loader } from 'lucide-react'

export default function UploadModal({ targetPath, onClose, onUploadComplete }) {
    const [files, setFiles] = useState([])
    const [uploading, setUploading] = useState(false)
    const [uploadProgress, setUploadProgress] = useState({})
    const [dragActive, setDragActive] = useState(false)
    const fileInputRef = useRef(null)

    const handleDrag = useCallback((e) => {
        e.preventDefault()
        e.stopPropagation()
        if (e.type === 'dragenter' || e.type === 'dragover') {
            setDragActive(true)
        } else if (e.type === 'dragleave') {
            setDragActive(false)
        }
    }, [])

    const handleDrop = useCallback((e) => {
        e.preventDefault()
        e.stopPropagation()
        setDragActive(false)

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            addFiles(Array.from(e.dataTransfer.files))
        }
    }, [])

    const addFiles = (newFiles) => {
        // Filter out duplicates based on name
        const existingNames = new Set(files.map(f => f.name))
        const uniqueFiles = newFiles.filter(f => !existingNames.has(f.name))
        setFiles(prev => [...prev, ...uniqueFiles])
    }

    const handleFileSelect = (e) => {
        if (e.target.files && e.target.files.length > 0) {
            addFiles(Array.from(e.target.files))
        }
    }

    const removeFile = (fileName) => {
        setFiles(prev => prev.filter(f => f.name !== fileName))
    }

    const formatBytes = (bytes) => {
        if (bytes === 0) return '0 B'
        const k = 1024
        const sizes = ['B', 'KB', 'MB', 'GB']
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
    }

    const handleUpload = async () => {
        if (files.length === 0) return

        setUploading(true)
        const formData = new FormData()
        formData.append('targetPath', targetPath)

        files.forEach(file => {
            formData.append('files', file)
        })

        // Set all files to uploading state
        const initialProgress = {}
        files.forEach(file => {
            initialProgress[file.name] = { status: 'uploading' }
        })
        setUploadProgress(initialProgress)

        try {
            const res = await fetch('http://localhost:3001/api/upload', {
                method: 'POST',
                body: formData
            })

            const data = await res.json()

            // Update progress for each file
            const finalProgress = {}
            if (data.uploaded) {
                data.uploaded.forEach(item => {
                    finalProgress[item.file] = { status: 'success' }
                })
            }
            if (data.errors) {
                data.errors.forEach(item => {
                    finalProgress[item.file] = { status: 'error', error: item.error }
                })
            }
            setUploadProgress(finalProgress)

            // Wait a moment to show results, then close
            setTimeout(() => {
                onUploadComplete && onUploadComplete()
                onClose()
            }, 1500)
        } catch (e) {
            // Mark all as error
            const errorProgress = {}
            files.forEach(file => {
                errorProgress[file.name] = { status: 'error', error: e.message }
            })
            setUploadProgress(errorProgress)
            setUploading(false)
        }
    }

    const getFileStatus = (fileName) => {
        return uploadProgress[fileName] || null
    }

    const getStatusIcon = (status) => {
        if (!status) return null
        switch (status.status) {
            case 'uploading':
                return <Loader size={16} className="spin" />
            case 'success':
                return <CheckCircle size={16} className="status-success" />
            case 'error':
                return <AlertCircle size={16} className="status-error" />
            default:
                return null
        }
    }

    return (
        <div className="upload-modal-overlay" onClick={onClose}>
            <div className="upload-modal" onClick={e => e.stopPropagation()}>
                <div className="upload-modal-header">
                    <h2><Upload size={20} /> Upload Files</h2>
                    <button className="icon-btn" onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>

                <div className="upload-modal-body">
                    <div className="upload-target-path">
                        <Folder size={16} />
                        <span>Uploading to: <strong>{targetPath}</strong></span>
                    </div>

                    {/* Drop Zone */}
                    <div
                        className={`drop-zone ${dragActive ? 'drag-active' : ''} ${files.length > 0 ? 'has-files' : ''}`}
                        onDragEnter={handleDrag}
                        onDragLeave={handleDrag}
                        onDragOver={handleDrag}
                        onDrop={handleDrop}
                        onClick={() => !uploading && fileInputRef.current?.click()}
                    >
                        <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            onChange={handleFileSelect}
                            style={{ display: 'none' }}
                            disabled={uploading}
                        />
                        <div className="drop-zone-content">
                            <Upload size={48} />
                            <p>Drag & drop files here</p>
                            <span>or click to browse</span>
                        </div>
                    </div>

                    {/* File List */}
                    {files.length > 0 && (
                        <div className="upload-file-list">
                            <div className="upload-file-list-header">
                                <span>{files.length} file{files.length > 1 ? 's' : ''} selected</span>
                                <span className="total-size">{formatBytes(files.reduce((sum, f) => sum + f.size, 0))}</span>
                            </div>
                            {files.map(file => {
                                const status = getFileStatus(file.name)
                                return (
                                    <div key={file.name} className={`upload-file-item ${status?.status || ''}`}>
                                        <File size={18} />
                                        <span className="file-name">{file.name}</span>
                                        <span className="file-size">{formatBytes(file.size)}</span>
                                        <div className="file-status">
                                            {getStatusIcon(status)}
                                        </div>
                                        {!uploading && (
                                            <button
                                                className="remove-file-btn"
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    removeFile(file.name)
                                                }}
                                            >
                                                <X size={16} />
                                            </button>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>

                <div className="upload-modal-footer">
                    <button className="btn btn-secondary" onClick={onClose} disabled={uploading}>
                        Cancel
                    </button>
                    <button
                        className="btn btn-primary"
                        onClick={handleUpload}
                        disabled={files.length === 0 || uploading}
                    >
                        {uploading ? (
                            <>
                                <Loader size={18} className="spin" />
                                Uploading...
                            </>
                        ) : (
                            <>
                                <Upload size={18} />
                                Upload {files.length > 0 ? `(${files.length})` : ''}
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    )
}
