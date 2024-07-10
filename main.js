#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const tar = require('tar');
const semver = require('semver');

const packageJsonPath = path.resolve(process.cwd(), 'package.json');

function add(packageName) {
  if (!fs.existsSync(packageJsonPath)) {
    console.error('Error: package.json not found in the current directory.');
    process.exit(1);
  }

  const [name, version] = packageName.split('@');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

  if (!packageJson.dependencies) {
    packageJson.dependencies = {};
  }

  packageJson.dependencies[name] = version || 'latest';

  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
  console.log(`Added ${packageName} to dependencies.`);
}

function fetchPackageInfo(packageName, callback) {
  https.get(`https://registry.npmjs.org/${packageName}`, (res) => {
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    res.on('end', () => {
      callback(JSON.parse(data));
    });
  }).on('error', (err) => {
    console.error(`Error fetching package info: ${err.message}`);
  });
}

function resolveVersion(packageInfo, versionRange) {
  const versions = Object.keys(packageInfo.versions);
  const maxSatisfying = semver.maxSatisfying(versions, versionRange);
  if (!maxSatisfying) {
    throw new Error(`No matching version found for ${versionRange}`);
  }
  return maxSatisfying;
}

let installed = new Map();

function downloadAndExtractPackage(packageName, version, callback) {
  const packageDir = path.resolve(process.cwd(), 'node_modules', packageName);

  if (!fs.existsSync(packageDir)) {
    fs.mkdirSync(packageDir, { recursive: true });
  }

  fetchPackageInfo(packageName, (packageInfo) => {
    const resolvedVersion = resolveVersion(packageInfo, version);
    if (installed.has(packageName)) {
      const installedVersion = installed.get(packageName);
      if (semver.satisfies(installedVersion, version)) {
        console.log(`Already installed ${packageName}@${installedVersion}.`);
        callback(null);
        return;
      }
      else if (semver.lt(resolvedVersion, installedVersion)) {
        console.error(`Warning: the more recent ${packageName}@${installedVersion} is already installed; skipping ${packageName}@${resolvedVersion}.`);
        callback(null);
        return;
      }
      else {
        console.error(`Warning: overwriting ${packageName}@${installedVersion} with ${packageName}@${resolvedVersion}.`);
      }
    }
    const tarballUrl = packageInfo.versions[resolvedVersion].dist.tarball;

      https.get(tarballUrl, (res) => {
        const tarballPath = path.join(packageDir, `${packageName}.tgz`);
        const file = fs.createWriteStream(tarballPath);

        res.pipe(file);
        file.on('finish', () => {
          file.close(() => {
            tar.x({
              file: tarballPath,
              cwd: packageDir,
              strip: 1
            }).then(() => {
              fs.unlinkSync(tarballPath); // Remove the tarball after extraction
            console.log(`Installed ${packageName}@${resolvedVersion}`);
            installed.set(packageName, version);
            callback(packageInfo.versions[resolvedVersion].dependencies);
            }).catch(err => {
              console.error(`Error extracting package: ${err.message}`);
      });
    });
        });
      }).on('error', (err) => {
        console.error(`Error downloading package: ${err.message}`);
      });
  });
}


function installDependencies(dependencies, callback) {
  const installQueue = Object.entries(dependencies);
  const installNext = () => {
    if (installQueue.length === 0) {
      callback();
      return;
    }

    const [name, version] = installQueue.shift();
    fetchPackageInfo(name, (packageInfo) => {
      const resolvedVersion = version === 'latest' ? packageInfo['dist-tags'].latest : resolveVersion(packageInfo, version);
      downloadAndExtractPackage(name, resolvedVersion, (deps) => {
        if (deps) {
          installDependencies(deps, installNext);
} else {
          installNext();
}
      });
    });
  };

  installNext();
}

function install() {
  if (!fs.existsSync(packageJsonPath)) {
    console.error('Error: package.json not found in the current directory.');
    process.exit(1);
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  const dependencies = packageJson.dependencies || {};

  installDependencies(dependencies, () => {
    console.log('All packages installed.');
  });
}

const command = process.argv[2];
const argument = process.argv[3];

if (command === 'add') {
  add(argument);
} else if (command === 'install') {
  install();
} else {
  console.log('Usage:');
  console.log('  add <package_name> - Adds the dependency to the "dependencies" object in package.json');
  console.log('  install - Downloads all of the packages that are specified in package.json');
}
