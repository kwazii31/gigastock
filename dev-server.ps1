$ErrorActionPreference = 'Stop'

$HostName = '127.0.0.1'
$Port = 8000
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$RemoteStockUrl = 'https://api.growagarden2wiki.net/api/v1/games/grow-a-garden-2/stock'

$mimeTypes = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.txt'  = 'text/plain; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.gif'  = 'image/gif'
  '.webp' = 'image/webp'
  '.ico'  = 'image/x-icon'
}

function Write-ResponseBytes {
  param(
    [Parameter(Mandatory = $true)] [System.Net.HttpListenerResponse] $Response,
    [Parameter(Mandatory = $true)] [byte[]] $Bytes,
    [Parameter(Mandatory = $true)] [int] $StatusCode,
    [Parameter(Mandatory = $true)] [string] $ContentType
  )

  $Response.StatusCode = $StatusCode
  $Response.ContentType = $ContentType
  $Response.Headers['Cache-Control'] = 'no-store'
  $Response.ContentLength64 = $Bytes.Length
  $Response.OutputStream.Write($Bytes, 0, $Bytes.Length)
  $Response.OutputStream.Close()
}

function Write-Json {
  param(
    [Parameter(Mandatory = $true)] [System.Net.HttpListenerResponse] $Response,
    [Parameter(Mandatory = $true)] [int] $StatusCode,
    [Parameter(Mandatory = $true)] $Object
  )

  $json = ($Object | ConvertTo-Json -Depth 10)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  Write-ResponseBytes -Response $Response -Bytes $bytes -StatusCode $StatusCode -ContentType 'application/json; charset=utf-8'
}

function Proxy-LiveStock {
  param([System.Net.HttpListenerResponse] $Response)

  try {
    $headers = @{
      'Accept' = 'application/json, text/plain, */*'
      'Origin' = 'https://growagarden2wiki.net'
      'Referer' = 'https://growagarden2wiki.net/stock/'
      'User-Agent' = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'
    }

    $upstream = Invoke-WebRequest -UseBasicParsing -Uri $RemoteStockUrl -Headers $headers -Method Get -TimeoutSec 20
    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($upstream.Content)
    $contentType = if ($upstream.Headers['Content-Type']) { $upstream.Headers['Content-Type'] } else { 'application/json; charset=utf-8' }
    Write-ResponseBytes -Response $Response -Bytes $bodyBytes -StatusCode ([int]$upstream.StatusCode) -ContentType $contentType
  } catch {
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      $status = [int]$_.Exception.Response.StatusCode
      try {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $body = $reader.ReadToEnd()
        $reader.Close()
        if ([string]::IsNullOrWhiteSpace($body)) {
          Write-Json -Response $Response -StatusCode $status -Object @{ error = 'upstream_http_error'; message = $_.Exception.Message }
        } else {
          $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
          Write-ResponseBytes -Response $Response -Bytes $bytes -StatusCode $status -ContentType 'application/json; charset=utf-8'
        }
      } catch {
        Write-Json -Response $Response -StatusCode $status -Object @{ error = 'upstream_http_error'; message = $_.Exception.Message }
      }
    } else {
      Write-Json -Response $Response -StatusCode 502 -Object @{ error = 'proxy_request_failed'; message = $_.Exception.Message }
    }
  }
}

function Serve-StaticFile {
  param(
    [System.Net.HttpListenerRequest] $Request,
    [System.Net.HttpListenerResponse] $Response
  )

  $rawPath = $Request.Url.AbsolutePath
  if ($rawPath -eq '/') { $rawPath = '/index.html' }

  $safeRelative = $rawPath.TrimStart('/') -replace '/', [System.IO.Path]::DirectorySeparatorChar
  $fullPath = [System.IO.Path]::GetFullPath((Join-Path $Root $safeRelative))

  if (-not $fullPath.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase)) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes('Forbidden')
    Write-ResponseBytes -Response $Response -Bytes $bytes -StatusCode 403 -ContentType 'text/plain; charset=utf-8'
    return
  }

  if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes('Not found')
    Write-ResponseBytes -Response $Response -Bytes $bytes -StatusCode 404 -ContentType 'text/plain; charset=utf-8'
    return
  }

  $bytes = [System.IO.File]::ReadAllBytes($fullPath)
  $ext = [System.IO.Path]::GetExtension($fullPath).ToLowerInvariant()
  $contentType = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { 'application/octet-stream' }
  Write-ResponseBytes -Response $Response -Bytes $bytes -StatusCode 200 -ContentType $contentType
}

$listener = New-Object System.Net.HttpListener
$prefix = "http://${HostName}:${Port}/"
$listener.Prefixes.Add($prefix)
$listener.Start()

Write-Host "GAG2 PowerShell server running at $prefix"
Write-Host 'Serves static tracker files and proxies /api/gag2-stock.json'

while ($listener.IsListening) {
  $context = $listener.GetContext()
  $request = $context.Request
  $response = $context.Response

  try {
    if ($request.HttpMethod -ne 'GET') {
      $response.StatusCode = 405
      $response.OutputStream.Close()
      continue
    }

    if ($request.Url.AbsolutePath -eq '/api/gag2-stock.json') {
      Proxy-LiveStock -Response $response
    } else {
      Serve-StaticFile -Request $request -Response $response
    }
  } catch {
    try {
      Write-Json -Response $response -StatusCode 500 -Object @{ error = 'internal_server_error'; message = $_.Exception.Message }
    } catch {
      $response.OutputStream.Close()
    }
  }
}
