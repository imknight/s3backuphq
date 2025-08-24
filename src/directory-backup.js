const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { promisify } = require('util');
const crypto = require('crypto');
const os = require('os');
const { sanitizeString, sanitizeFilePath } = require('./config');
const { generateTimestampedFilename } = require('./utils');

// Create secure temporary file with restricted permissions
const createSecureTempFile = (prefix, suffix = '') => {
  const tempDir = os.tmpdir();
  const fileName = `${prefix}-${crypto.randomBytes(16).toString('hex')}${suffix}`;
  const tempPath = path.join(tempDir, fileName);
  
  // Create file with restrictive permissions (600)
  const fd = fs.openSync(tempPath, 'w', 0o600);
  fs.closeSync(fd);
  
  return tempPath;
};

class DirectoryBackup {
  constructor(logger) {
    this.logger = logger;
  }

  async backupDirectory(directoryConfig, outputPath, timestamp) {
    const { name, path: dirPath, exclude = [] } = directoryConfig;
    
    // Sanitize inputs
    const safeName = sanitizeString(name);
    const safeDirPath = sanitizeFilePath(dirPath);
    const safeOutputPath = sanitizeFilePath(outputPath);
    
    this.logger.info(`Starting backup of directory: ${name} (${safeDirPath})`);
    
    // Validate source directory exists and is accessible
    if (!fs.existsSync(safeDirPath)) {
      throw new Error(`Directory not found: ${safeDirPath}`);
    }
    
    const stats = fs.statSync(safeDirPath);
    if (!stats.isDirectory()) {
      throw new Error(`Source path is not a directory: ${safeDirPath}`);
    }
    
    // Create temporary file with secure permissions
    const tempArchivePath = createSecureTempFile(`dir-${safeName}`, '.tar.gz');
    const timestampedFilename = generateTimestampedFilename(safeName, '.tar.gz', timestamp);
    const finalArchivePath = path.join(safeOutputPath, timestampedFilename);
    
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(tempArchivePath, { mode: 0o600 });
      const archive = archiver('tar', {
        gzip: true,
        gzipOptions: {
          level: 9
        }
      });
      
      output.on('close', () => {
        try {
          // Move to final location with proper permissions
          fs.copyFileSync(tempArchivePath, finalArchivePath);
          fs.chmodSync(finalArchivePath, 0o600);
          
          const finalStats = fs.statSync(finalArchivePath);
          
          this.logger.info(`Directory backup completed: ${name} (${finalStats.size} bytes)`);
          resolve({
            name,
            path: finalArchivePath,
            size: finalStats.size
          });
        } catch (error) {
          reject(new Error(`Failed to finalize archive for ${name}: ${error.message}`));
        } finally {
          // Clean up temporary file
          if (fs.existsSync(tempArchivePath)) {
            fs.unlinkSync(tempArchivePath);
          }
        }
      });
      
      output.on('error', (err) => {
        // Clean up temporary file on error
        if (fs.existsSync(tempArchivePath)) {
          fs.unlinkSync(tempArchivePath);
        }
        reject(err);
      });
      
      archive.on('error', (err) => {
        // Clean up temporary file on error
        if (fs.existsSync(tempArchivePath)) {
          fs.unlinkSync(tempArchivePath);
        }
        reject(new Error(`Archive creation failed for ${name}: ${err.message}`));
      });
      
      archive.pipe(output);
      
      // Sanitize exclusion patterns
      const safeExclude = exclude.map(pattern => {
        if (typeof pattern !== 'string') {
          this.logger.warn(`Invalid exclusion pattern type: ${typeof pattern}`);
          return '';
        }
        // Remove potentially dangerous patterns
        return pattern.replace(/[;&|`$(){}\[\]<>"'\\]/g, '');
      }).filter(pattern => pattern.length > 0);
      
      archive.glob('**/*', {
        cwd: safeDirPath,
        ignore: safeExclude,
        dot: true,
        // Security: prevent following symlinks outside the directory
        follow: false
      });
      
      archive.finalize();
    });
  }
  
  async backupDirectories(directories, outputPath, timestamp) {
    const results = [];
    
    for (const directory of directories) {
      try {
        const result = await this.backupDirectory(directory, outputPath, timestamp);
        results.push(result);
      } catch (error) {
        this.logger.error(`Failed to backup directory ${directory.name}: ${error.message}`);
        throw error;
      }
    }
    
    return results;
  }
}

module.exports = DirectoryBackup;