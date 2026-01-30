Param(
    [string]$SiteUrl = "https://example.com",
    [string]$OutputDir = "."
)

function Get-StringBetween {
    param([string]$text, [string]$startTag, [string]$endTag)
    $s = $text.IndexOf($startTag)
    if ($s -lt 0) { return $null }
    $s = $s + $startTag.Length
    $e = $text.IndexOf($endTag, $s)
    if ($e -lt 0) { return $null }
    return $text.Substring($s, $e - $s)
}

function To-Rfc822 {
    param([datetime]$dt)
    return $dt.ToUniversalTime().ToString("r")
}

function To-ISODate {
    param([datetime]$dt)
    return $dt.ToString("yyyy-MM-dd")
}

$htmlFiles = Get-ChildItem -File -Filter "*.html" -ErrorAction Stop
if (-not $htmlFiles) { Write-Host "No HTML files found."; exit 0 }

if (-not (Test-Path $OutputDir)) { New-Item -ItemType Directory -Path $OutputDir | Out-Null }

# Generate sitemap.xml
$sitemap = @()
$sitemap += '<?xml version="1.0" encoding="UTF-8"?>'
$sitemap += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
foreach ($f in $htmlFiles) {
    $path = if ($f.Name -ieq "index.html") { "/" } else { "/" + ($f.BaseName) + "/" }
    $lastmod = To-ISODate ($f.LastWriteTime)
    $sitemap += "<url><loc>$SiteUrl$path</loc><lastmod>$lastmod</lastmod><changefreq>daily</changefreq><priority>0.7</priority></url>"
}
$sitemap += '</urlset>'
$sitemap | Out-File -LiteralPath (Join-Path $OutputDir "sitemap.xml") -Encoding utf8

# Generate rss.xml (simple: one item per HTML page)
$indexPath = Join-Path (Get-Location) "index.html"
$raw = if (Test-Path $indexPath) { Get-Content -Raw -LiteralPath $indexPath } else { "" }
$title = Get-StringBetween $raw "<title>" "</title>"
if (-not $title) { $title = "천금문 (千金門) - 무림 투자 커뮤니티" }
$desc = Get-StringBetween $raw '<meta name="description" content="' '"'
if (-not $desc) { $desc = "천금문 — 무림 투자 커뮤니티" }
$now = To-Rfc822 (Get-Date)

$rss = @()
$rss += '<?xml version="1.0" encoding="UTF-8"?>'
$rss += '<rss version="2.0">'
$rss += '<channel>'
$rss += "<title>$title</title>"
$rss += "<link>$SiteUrl/</link>"
$rss += "<description>$desc</description>"
$rss += "<language>ko</language>"
$rss += "<lastBuildDate>$now</lastBuildDate>"
foreach ($f in $htmlFiles) {
    $pageTitle = $title
    $itemLink = if ($f.Name -ieq "index.html") { "$SiteUrl/" } else { "$SiteUrl/" + ($f.BaseName) + "/" }
    $pubDate = To-Rfc822 ($f.LastWriteTime)
    $rss += '<item>'
    $rss += "<title>$pageTitle</title>"
    $rss += "<link>$itemLink</link>"
    $rss += "<guid isPermaLink='true'>$itemLink</guid>"
    $rss += "<pubDate>$pubDate</pubDate>"
    $rss += '</item>'
}
$rss += '</channel>'
$rss += '</rss>'
$rss | Out-File -LiteralPath (Join-Path $OutputDir "rss.xml") -Encoding utf8

# Generate robots.txt
$robots = @()
$robots += 'User-agent: *'
$robots += 'Allow: /'
$robots += "Sitemap: $SiteUrl/sitemap.xml"
Set-Content -LiteralPath (Join-Path $OutputDir "robots.txt") -Value $robots -Encoding ASCII

Write-Host "Generated: sitemap.xml, rss.xml, robots.txt -> $OutputDir"
