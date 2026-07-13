[CmdletBinding()]
param(
    # Dossier racine à analyser
    [string]$Root = $PSScriptRoot,

    # Liste uniquement les changements sans modifier
    [switch]$Preview,

    # Demande confirmation avant modification
    [switch]$ConfirmChanges
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

    # Supprime le préfixe k
    $Name = $Name.Substring(1)

    # XMLParser -> XML_Parser (creplace: -replace is case-insensitive, so [A-Z] would
    # also match lowercase and shred every letter pair -> C_AT_EG_OR...)
    $Name = $Name -creplace '([A-Z]+)([A-Z][a-z])', '$1_$2'

    # ParserRule -> Parser_Rule
    $Name = $Name -creplace '([a-z0-9])([A-Z])', '$1_$2'

    return $Name.ToUpperInvariant()
}

function Convert-ToCamelCase {
    param(
        [Parameter(Mandatory)]
        [string]$Name
    )

    # Supprime le préfixe v
    $Name = $Name.Substring(1)

    if ($Name.Length -eq 0) {
        return $Name
    }

    if ($Name.Length -eq 1) {
        return $Name.ToLowerInvariant()
    }

    # DefaultPort -> defaultPort
    # XMLParser -> XMLParser
    if ($Name[1] -cmatch '[a-z]') {
        return $Name.Substring(0, 1).ToLowerInvariant() + $Name.Substring(1)
    }

    return $Name
}

function Convert-VariableName {
    param(
        [Parameter(Mandatory)]
        [string]$Name
    )

    switch ($Name[0]) {
        'k' {
            return Convert-ToConstCase $Name
        }

        'v' {
            return Convert-ToCamelCase $Name
        }

        # Not a k/v identifier: leave untouched (guards against silent deletion in the
        # replace callback if the match regex ever broadens).
        default {
            return $Name
        }
    }
}

#
# Recherche des fichiers
#
$Files = Get-ChildItem `
    -Path $Root `
    -Recurse `
    -File `
    -Include $Extensions |
    Where-Object {
        # Skip deps, build output, and any dot-directory (.angular / .git / .vscode ...).
        # Those hold generated files (e.g. base64-encoded WASM) whose blobs contain
        # k/v-looking fragments the replacer would corrupt.
        $_.FullName -notmatch '\\(node_modules|dist|\.[^\\]+)\\'
    }

if ($Files.Count -eq 0) {
    Write-Host "Aucun fichier trouvé." -ForegroundColor Yellow
    exit
}

$Regex = '\b[kv][A-Z][A-Za-z0-9]*\b'

#
# Phase 1 : Analyse des identifiants
#
$Occurrences = @{}

foreach ($FileInfo in $Files) {

    $Content = [System.IO.File]::ReadAllText($FileInfo.FullName)

    foreach ($Match in [regex]::Matches($Content, $Regex)) {

        if ($Occurrences.ContainsKey($Match.Value)) {
            $Occurrences[$Match.Value]++
        }
        else {
            $Occurrences[$Match.Value] = 1
        }
    }
}

if ($Occurrences.Count -eq 0) {
    Write-Host "Aucun identifiant k/v trouvé." -ForegroundColor Yellow
    exit
}

Write-Host ""
Write-Host "Identifiants détectés :" -ForegroundColor Cyan
Write-Host ""

$Occurrences.GetEnumerator() |
    Sort-Object Key |
    ForEach-Object {

        $NewName = Convert-VariableName $_.Key

        Write-Host (
            "{0,-35} -> {1,-35} ({2} occurrence(s))" -f `
            $_.Key,
            $NewName,
            $_.Value
        )
    }

Write-Host ""

#
# Mode Preview
#
if ($Preview) {

    Write-Host "Mode Preview : aucune modification effectuée." `
        -ForegroundColor Yellow

    exit
}

#
# Confirmation
#
if ($ConfirmChanges) {

    $Answer = Read-Host "Effectuer les remplacements ? (y/N)"

    if ($Answer -notmatch '^[yY]$') {

        Write-Host "Opération annulée." `
            -ForegroundColor Yellow

        exit
    }
}

#
# Phase 2 : Remplacement
#
$ModifiedFiles = 0
$Replacements = 0

$TotalFiles = $Files.Count
$CurrentFile = 0

foreach ($FileInfo in $Files) {

    $CurrentFile++

    Write-Progress `
        -Activity "Conversion des variables" `
        -Status "$CurrentFile / $TotalFiles - $($FileInfo.Name)" `
        -CurrentOperation "Remplacements : $Replacements" `
        -PercentComplete (($CurrentFile / [Math]::Max($TotalFiles, 1)) * 100)

    $File = $FileInfo.FullName

    $Content = [System.IO.File]::ReadAllText($File)

    # Count here, not inside the callback: a scriptblock passed as a MatchEvaluator
    # delegate runs in its own scope, so $Count++ inside it never reaches this scope.
    $Count = [regex]::Matches($Content, $Regex).Count

    $NewContent = [regex]::Replace(
        $Content,
        $Regex,
        {
            param($Match)

            Convert-VariableName $Match.Value
        }
    )

    if ($NewContent -ne $Content) {

        [System.IO.File]::WriteAllText(
            $File,
            $NewContent,
            [System.Text.UTF8Encoding]::new($false)
        )

        $ModifiedFiles++
        $Replacements += $Count

        Write-Verbose ("[{0}] {1}" -f $Count, $File)
    }
}

Write-Progress `
    -Activity "Conversion des variables" `
    -Completed

Write-Host ""
Write-Host "Terminé." -ForegroundColor Cyan
Write-Host ("Fichiers modifiés : {0}" -f $ModifiedFiles)
Write-Host ("Remplacements     : {0}" -f $Replacements)
