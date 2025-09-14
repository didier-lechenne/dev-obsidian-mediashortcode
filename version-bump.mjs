import { readFileSync, writeFileSync, existsSync } from "fs";
import { execSync } from "child_process";

const targetVersion = process.env.npm_package_version;

// read minAppVersion from manifest.json and bump version to target version
let manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
const currentVersion = manifest.version;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t"));

// update versions.json with target version and minAppVersion from manifest.json
let versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, "\t"));

console.log(`🔄 Version mise à jour vers ${targetVersion}`);

// Build le projet
console.log(`🔨 Construction du projet...`);
try {
    execSync('npm run build', { stdio: 'inherit' });
    console.log(`✅ Construction terminée`);
} catch (error) {
    console.error(`❌ Échec de la construction:`, error.message);
    process.exit(1);
}

// Vérifier les fichiers requis
const requiredFiles = ['manifest.json', 'main.js'];
const styleFile = existsSync('styles.css') ? 'styles.css' : null;

for (const file of requiredFiles) {
    if (!existsSync(file)) {
        console.error(`❌ Fichier requis manquant: ${file}`);
        process.exit(1);
    }
}

// Git operations
console.log(`📝 Commit des changements...`);
try {
    execSync('git add manifest.json versions.json main.js package.json', { stdio: 'inherit' });
    if (styleFile) {
        execSync(`git add ${styleFile}`, { stdio: 'inherit' });
    }
    execSync(`git commit -m "Release v${targetVersion}"`, { stdio: 'inherit' });
    
    // Créer et pousser le tag
    execSync(`git tag v${targetVersion}`, { stdio: 'inherit' });
    execSync(`git push origin main`, { stdio: 'inherit' });
    execSync(`git push origin v${targetVersion}`, { stdio: 'inherit' });
    
    console.log(`✅ Tag v${targetVersion} créé et poussé`);
} catch (error) {
    console.error(`❌ Opérations git échouées:`, error.message);
    process.exit(1);
}

// Créer la release GitHub
console.log(`🚀 Création de la release GitHub...`);
try {
    // Supprimer la release existante si elle existe
    try {
        execSync(`gh release delete v${targetVersion} --yes`, { stdio: 'ignore' });
    } catch (e) {
        // Release n'existe pas, normal
    }

    // Construire la commande de release
    let releaseCommand = `gh release create v${targetVersion} manifest.json main.js`;
    if (styleFile) {
        releaseCommand += ` ${styleFile}`;
    }
    
    const releaseNotes = `Release v${targetVersion}

## Installation

### Via BRAT (recommandé)
1. Installez [BRAT](obsidian://show-plugin?id=obsidian42-brat)
2. Dans les paramètres BRAT, ajoutez: \`didier-lechenne/dev-obsidian-mediashortcode\`
3. Activez le plugin

### Installation manuelle  
1. Téléchargez les fichiers depuis cette release
2. Créez le dossier \`mediashortcode\` dans \`.obsidian/plugins/\`
3. Placez les fichiers dans ce dossier
4. Activez le plugin dans Obsidian

## Fonctionnalités
- Légendes d'images améliorées avec syntaxe flexible
- Support imagenote, video, figure avec paramètres CSS
- Intégration YouTube/Vimeo
- Compatible avec l'ancienne syntaxe

${currentVersion !== targetVersion ? `Mise à jour depuis v${currentVersion}` : ''}`;

    releaseCommand += ` --title "Release v${targetVersion}" --notes "${releaseNotes}"`;
    
    execSync(releaseCommand, { stdio: 'inherit' });
    console.log(`✅ Release GitHub créée!`);
    
} catch (error) {
    console.error(`❌ Échec release GitHub:`, error.message);
    console.error(`Release manuelle: https://github.com/didier-lechenne/dev-obsidian-mediashortcode/releases`);
}

console.log(`🎉 Release v${targetVersion} terminée!`);
console.log(`🌐 Release: https://github.com/didier-lechenne/dev-obsidian-mediashortcode/releases`);
console.log(`📋 BRAT: didier-lechenne/dev-obsidian-mediashortcode`);