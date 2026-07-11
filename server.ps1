$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:4567/")

try {
    $listener.Start()
} catch {
    Write-Host "Server port 4567 is already in use or blocked."
    Start-Process "http://localhost:4567"
    Exit
}

Write-Host "=========================================================="
Write-Host "     VITTHAL OIL MILL OS WEB SERVER RUNNING"
Write-Host "=========================================================="
Write-Host "  -> Hosting link: http://localhost:4567"
Write-Host "  -> Database: 100% Active (Auto-Saves Permanently)"
Write-Host "=========================================================="
Write-Host "Keep this window open. Press Ctrl + C to stop."
Write-Host ""

# Open browser automatically
Start-Process "http://localhost:4567"

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response
        
        $path = $request.Url.LocalPath
        if ($path -eq "/") { $path = "/index.html" }
        
        # Parse path relative to current folder
        $relPath = $path.TrimStart("/")
        $localPath = Join-Path (Get-Location) $relPath
        
        if (Test-Path $localPath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($localPath).ToLower()
            $mime = switch ($ext) {
                ".html" { "text/html; charset=utf-8" }
                ".css"  { "text/css; charset=utf-8" }
                ".js"   { "application/javascript; charset=utf-8" }
                ".png"  { "image/png" }
                ".jpg"  { "image/jpeg" }
                ".jpeg" { "image/jpeg" }
                ".svg"  { "image/svg+xml" }
                ".json" { "application/json" }
                default { "application/octet-stream" }
            }
            
            $bytes = [System.IO.File]::ReadAllBytes($localPath)
            $response.ContentType = $mime
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $response.StatusCode = 404
            $html = "<h1>404 File Not Found</h1><p>Requested: $path</p>"
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($html)
            $response.ContentType = "text/html"
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        }
        $response.Close()
    } catch {
        break
    }
}
$listener.Close()
