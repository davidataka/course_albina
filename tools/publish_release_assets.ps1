param(
    [string]$Repository = 'davidataka/course_albina',
    [string]$Tag = 'course-videos-720p',
    [string]$Manifest = '.work/site-release-assets.tsv',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$manifestPath = (Resolve-Path (Join-Path $workspace $Manifest)).Path
$bundledGit = 'C:\Users\User\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe'
$git = if (Test-Path -LiteralPath $bundledGit) { $bundledGit } else { (Get-Command git -ErrorAction Stop).Source }
$safe = 'safe.directory=' + ($workspace -replace '\\', '/')

$credentialLines = @("protocol=https`nhost=github.com`n`n" | & $git -c $safe credential fill)
$credential = @{}
foreach ($line in $credentialLines) {
    if ($line -match '^([^=]+)=(.*)$') { $credential[$matches[1]] = $matches[2] }
}
if (-not $credential.password) { throw 'GitHub credential is unavailable.' }

$headers = @{
    Authorization = 'Bearer ' + $credential.password
    Accept = 'application/vnd.github+json'
    'X-GitHub-Api-Version' = '2022-11-28'
    'User-Agent' = 'Codex-course-site'
}

$rows = foreach ($line in Get-Content -LiteralPath $manifestPath) {
    if (-not $line.Trim()) { continue }
    $parts = $line -split "`t", 3
    if ($parts.Count -ne 3) { throw "Invalid manifest row: $line" }
    $file = Get-Item -LiteralPath $parts[1]
    [pscustomobject]@{ Name = $parts[0]; Path = $file.FullName; Label = $parts[2]; Size = $file.Length }
}

if ($rows.Count -ne 31) { throw "Expected 31 video assets, found $($rows.Count)." }
if (($rows.Name | Select-Object -Unique).Count -ne $rows.Count) { throw 'Release asset names are not unique.' }

$allReleases = @(Invoke-RestMethod -Uri "https://api.github.com/repos/$Repository/releases?per_page=100" -Headers $headers)
$release = $allReleases |
    Where-Object { $_.tag_name -eq $Tag } |
    Sort-Object -Property @{ Expression = { @($_.assets).Count }; Descending = $true }, @{ Expression = 'created_at'; Descending = $false } |
    Select-Object -First 1

if (-not $release) {
    if ($DryRun) {
        Write-Output "DRY RUN: release $Tag would be created."
    } else {
        $body = @{
            tag_name = $Tag
            target_commitish = 'master'
            name = 'Видео курса — 720p'
            body = 'Видео среднего качества для архивной версии курса. Используются плеерами GitHub Pages.'
            draft = $true
            prerelease = $false
        } | ConvertTo-Json
        $release = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$Repository/releases" -Headers $headers -ContentType 'application/json' -Body $body
        Write-Output "Created draft release $Tag (id $($release.id))."
    }
}

if ($DryRun) {
    $total = ($rows | Measure-Object Size -Sum).Sum
    Write-Output ("DRY RUN: {0} assets, {1:N2} GiB." -f $rows.Count, ($total / 1GB))
    $rows | ForEach-Object { Write-Output ("{0}`t{1:N2} MiB" -f $_.Name, ($_.Size / 1MB)) }
    exit 0
}

$release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repository/releases/$($release.id)" -Headers $headers
$existing = @{}
foreach ($asset in $release.assets) { $existing[$asset.name] = $asset }
$uploadBase = $release.upload_url -replace '\{.*$', ''

$handler = [System.Net.Http.HttpClientHandler]::new()
$client = [System.Net.Http.HttpClient]::new($handler)
$client.Timeout = [System.Threading.Timeout]::InfiniteTimeSpan
$client.DefaultRequestHeaders.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $credential.password)
$client.DefaultRequestHeaders.Accept.Add([System.Net.Http.Headers.MediaTypeWithQualityHeaderValue]::new('application/vnd.github+json'))
$client.DefaultRequestHeaders.UserAgent.ParseAdd('Codex-course-site')
$client.DefaultRequestHeaders.Add('X-GitHub-Api-Version', '2022-11-28')

try {
    $index = 0
    foreach ($row in $rows) {
        $index++
        if ($existing.ContainsKey($row.Name)) {
            $remote = $existing[$row.Name]
            if ([int64]$remote.size -ne [int64]$row.Size) {
                throw "Asset $($row.Name) exists with a different size."
            }
            Write-Output "[$index/$($rows.Count)] Already uploaded: $($row.Name)"
            continue
        }

        $uri = $uploadBase + '?name=' + [uri]::EscapeDataString($row.Name) + '&label=' + [uri]::EscapeDataString($row.Label)
        $uploaded = $false
        for ($attempt = 1; $attempt -le 3 -and -not $uploaded; $attempt++) {
            Write-Output ("[{0}/{1}] Uploading {2} ({3:N2} MiB), attempt {4}/3..." -f $index, $rows.Count, $row.Name, ($row.Size / 1MB), $attempt)
            $stream = [System.IO.File]::OpenRead($row.Path)
            $content = $null
            try {
                $content = [System.Net.Http.StreamContent]::new($stream)
                $content.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::new('video/mp4')
                $response = $client.PostAsync($uri, $content).GetAwaiter().GetResult()
                $responseBody = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
                if (-not $response.IsSuccessStatusCode) {
                    throw "HTTP $([int]$response.StatusCode) $responseBody"
                }
                $uploaded = $true
            } catch {
                $remoteAssets = @(Invoke-RestMethod -Uri "https://api.github.com/repos/$Repository/releases/$($release.id)/assets?per_page=100" -Headers $headers)
                $completedRemote = $remoteAssets | Where-Object { $_.name -eq $row.Name -and [int64]$_.size -eq [int64]$row.Size } | Select-Object -First 1
                if ($completedRemote) {
                    $uploaded = $true
                    Write-Output "[$index/$($rows.Count)] GitHub completed the asset after the connection closed: $($row.Name)"
                } elseif ($attempt -lt 3) {
                    Write-Warning "Upload attempt $attempt failed for $($row.Name): $($_.Exception.Message). Retrying."
                    Start-Sleep -Seconds 5
                } else {
                    throw "Upload failed after 3 attempts for $($row.Name): $($_.Exception.Message)"
                }
            } finally {
                if ($content) { $content.Dispose() }
                $stream.Dispose()
            }
        }
        Write-Output "[$index/$($rows.Count)] Uploaded: $($row.Name)"
    }
} finally {
    $client.Dispose()
    $handler.Dispose()
}

$publishBody = @{ draft = $false } | ConvertTo-Json
$published = Invoke-RestMethod -Method Patch -Uri "https://api.github.com/repos/$Repository/releases/$($release.id)" -Headers $headers -ContentType 'application/json' -Body $publishBody
Write-Output "Release published: $($published.html_url)"
