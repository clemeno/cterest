param(
    # Par défaut : dossier contenant ce script
    [string]$Root = $PSScriptRoot
)

# Extensions de fichiers à traiter
$Extensions = @(
    "*.js",
    "*.cjs",
    "*.mjs",
    "*.ts"
)

function Convert-ToConstCase {
    param(
        [Parameter(Mandatory)]
        [string]$Name
    )

    # Supprime le préfixe k ou v
    $Name = $Name.Substring(1)

    # XMLParser -> XML_Parser
    $Name = $Name -replace '([A-Z]+)([A-Z][a-z])', '$1_$2'

    # ParserRule -> Parser_Rule
    $Name = $Name -replace '([a-z0-9])([A-Z])', '$1_$2'

    return $Name.ToUpperInvariant()
}

$ModifiedFiles = 0
$Replacements = 0

Get-ChildItem -Path $Root -Recurse -File -Include $Extensions | ForEach-Object {

    $File = $_.FullName
    $Content = [System.IO.File]::ReadAllText($File)

    $Count = 0

    $NewContent = [regex]::Replace(
        $Content,
        '\b[kv][A-Z][A-Za-z0-9]*\b',
        {
            param($Match)

            $Count++
            Convert-ToConstCase $Match.Value
        }
    )

    if ($Count -gt 0) {
        [System.IO.File]::WriteAllText(
            $File,
            $NewContent,
            [System.Text.UTF8Encoding]::new($false)
        )

        $ModifiedFiles++
        $Replacements += $Count

        Write-Host ("[{0}] {1}" -f $Count, $File) -ForegroundColor Green
    }
}

Write-Host
Write-Host "Terminé." -ForegroundColor Cyan
Write-Host ("Fichiers modifiés : {0}" -f $ModifiedFiles)
Write-Host ("Remplacements     : {0}" -f $Replacements)
