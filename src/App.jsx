import { useState, useEffect } from 'react'
import FileExplorer from './components/FileExplorer'
import Cleaner from './components/Cleaner'
import DownloadManager from './components/DownloadManager'
import { Smartphone, RefreshCw, AlertTriangle, FolderOpen, Trash2 } from 'lucide-react'
import './index.css'

function App() {
  const [connectionStatus, setConnectionStatus] = useState('DISCONNECTED')
  const [activeTab, setActiveTab] = useState('explorer') // 'explorer' or 'cleaner'

  useEffect(() => {
    checkConnection()
    const interval = setInterval(checkConnection, 3000)
    return () => clearInterval(interval)
  }, [])

  const checkConnection = async () => {
    try {
      const res = await fetch('http://localhost:3001/api/status')
      const data = await res.json()
      setConnectionStatus(data.status)
    } catch (e) {
      setConnectionStatus('DISCONNECTED')
    }
  }

  const handleRetry = async () => {
    setConnectionStatus('CHECKING')
    try {
      await fetch('http://localhost:3001/api/connect', { method: 'POST' })
      setTimeout(checkConnection, 1000)
    } catch (e) {
      setConnectionStatus('DISCONNECTED')
    }
  }

  const getStatusClass = () => {
    if (connectionStatus === 'CONNECTED') return 'connected'
    if (connectionStatus === 'UNAUTHORIZED') return 'unauthorized'
    return 'disconnected'
  }

  const getStatusText = () => {
    if (connectionStatus === 'CONNECTED') return 'Connected'
    if (connectionStatus === 'UNAUTHORIZED') return 'Unauthorized'
    if (connectionStatus === 'CHECKING') return 'Checking...'
    return 'Disconnected'
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <Smartphone size={24} />
          </div>
          <h1>ADB Explorer</h1>
        </div>

        {/* Tab Navigation */}
        {connectionStatus === 'CONNECTED' && (
          <div className="tab-nav">
            <button
              className={`tab-btn ${activeTab === 'explorer' ? 'active' : ''}`}
              onClick={() => setActiveTab('explorer')}
            >
              <FolderOpen size={18} />
              <span>Files</span>
            </button>
            <button
              className={`tab-btn ${activeTab === 'cleaner' ? 'active' : ''}`}
              onClick={() => setActiveTab('cleaner')}
            >
              <Trash2 size={18} />
              <span>Cleaner</span>
            </button>
          </div>
        )}

        <button
          className={`status-badge ${getStatusClass()}`}
          onClick={handleRetry}
          title="Click to refresh connection"
        >
          <span className="status-dot"></span>
          <span>{getStatusText()}</span>
          {connectionStatus !== 'CONNECTED' && (
            <RefreshCw size={14} className={connectionStatus === 'CHECKING' ? 'spin' : ''} />
          )}
        </button>
      </header>

      <main className="main-content">
        {connectionStatus === 'CONNECTED' ? (
          <>
            {activeTab === 'explorer' && <FileExplorer />}
            {activeTab === 'cleaner' && <Cleaner />}
          </>
        ) : (
          <div className="disconnected-state">
            <div className="icon">
              <Smartphone size={56} />
            </div>

            <h2>
              {connectionStatus === 'UNAUTHORIZED'
                ? 'Authorization Required'
                : 'No Device Connected'}
            </h2>

            {connectionStatus === 'UNAUTHORIZED' ? (
              <>
                <div className="warning-banner">
                  <AlertTriangle size={20} />
                  <span>Check your phone for the USB debugging prompt</span>
                </div>
                <div className="info-card">
                  <h4>Steps to authorize:</h4>
                  <ul>
                    <li>Unlock your phone screen</li>
                    <li>Look for "Allow USB debugging?" popup</li>
                    <li>Check "Always allow from this computer"</li>
                    <li>Tap Allow</li>
                  </ul>
                </div>
              </>
            ) : (
              <>
                <p>Connect your Android device via USB with USB Debugging enabled.</p>
                <div className="info-card">
                  <h4>Troubleshooting:</h4>
                  <ul>
                    <li>Use a data-transfer capable USB cable</li>
                    <li>Set USB mode to File Transfer (MTP)</li>
                    <li>Install ADB drivers if on Windows</li>
                  </ul>
                </div>
              </>
            )}

            <button className="btn btn-primary" onClick={handleRetry}>
              <RefreshCw size={18} className={connectionStatus === 'CHECKING' ? 'spin' : ''} />
              {connectionStatus === 'CHECKING' ? 'Checking...' : 'Retry Connection'}
            </button>
          </div>
        )}
      </main>

      {/* Download Manager Floating Panel */}
      <DownloadManager />
    </div>
  )
}

export default App

