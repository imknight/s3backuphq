const { spawn } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const archiver = require('archiver');
const { sanitizeString, sanitizeFilePath } = require('./config');
const { generateTimestampedFilename } = require('./utils');

// Secure command execution helper
const execSecureCommand = (command, args, options = {}) => {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options
    });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Command failed with code ${code}: ${stderr}`));
      }
    });
    
    child.on('error', (error) => {
      reject(error);
    });
  });
};

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

// Create MySQL/MariaDB config file with credentials
const createMySQLConfigFile = (dbConfig) => {
  const configPath = createSecureTempFile(`${dbConfig.type}-config`, '.cnf');
  
  // Handle empty password case
  const passwordLine = dbConfig.password && dbConfig.password.length > 0 
    ? `password=${dbConfig.password}` 
    : '# No password required';
  
  const configContent = `[client]
host=${sanitizeString(dbConfig.host)}
port=${dbConfig.port}
user=${sanitizeString(dbConfig.username)}
${passwordLine}
default-character-set=${dbConfig.charset || 'utf8mb4'}
`;
  
  fs.writeFileSync(configPath, configContent, { mode: 0o600 });
  return configPath;
};

class DatabaseBackup {
  constructor(logger) {
    this.logger = logger;
  }

  async backupMySQL(dbConfig, outputPath, timestamp) {
    const { name, type, host, port, username, password, database, configFile, charset } = dbConfig;
    const dumpFile = createSecureTempFile(`${type}-${sanitizeString(name)}`, '.sql');
    const tempArchivePath = createSecureTempFile(`${type}-${sanitizeString(name)}`, '.tar.gz');
    const timestampedFilename = generateTimestampedFilename(sanitizeString(name), '.tar.gz', timestamp);
    const finalArchivePath = path.join(sanitizeFilePath(outputPath), timestampedFilename);
    
    this.logger.info(`Starting ${type.toUpperCase()} backup: ${name}`);
    
    let tempConfigFile = null;
    
    try {
      // Use existing config file or create temporary one
      const configPath = configFile ? 
        sanitizeFilePath(configFile) : 
        (tempConfigFile = createMySQLConfigFile(dbConfig));
      
      // Sanitize database name
      const safeDatabase = sanitizeString(database);
      
      // Use mysqldump with config file (works for both MySQL and MariaDB)
      const args = [
        `--defaults-file=${configPath}`,
        '--single-transaction',
        '--routines',
        '--triggers',
        '--events',
        '--add-drop-table',
        '--add-drop-database',
        '--create-options',
        '--disable-keys',
        '--extended-insert',
        '--quick',
        '--lock-tables=false',
        safeDatabase
      ];
      
      // Add MariaDB specific options if needed
      if (type === 'mariadb') {
        args.push('--skip-add-locks');
        args.push('--skip-comments');
      }
      
      // For empty passwords, add --skip-password option
      if (!password || password.length === 0) {
        args.push('--skip-password');
      }
      
      // Execute mysqldump with output redirection
      const result = await execSecureCommand('mysqldump', args);
      
      // Write SQL dump to temporary file
      fs.writeFileSync(dumpFile, result.stdout, { mode: 0o600 });
      
      // Create compressed archive containing the SQL dump
      const sqlFilename = generateTimestampedFilename(sanitizeString(name), '.sql', timestamp);
      await this.createCompressedArchive(dumpFile, tempArchivePath, sqlFilename);
      
      // Move to final location with proper permissions
      fs.copyFileSync(tempArchivePath, finalArchivePath);
      fs.chmodSync(finalArchivePath, 0o600);
      
      const stats = fs.statSync(finalArchivePath);
      
      this.logger.info(`${type.toUpperCase()} backup completed: ${name} (${stats.size} bytes compressed)`);
      
      return {
        name,
        path: finalArchivePath,
        size: stats.size
      };
    } catch (error) {
      this.logger.error(`${type.toUpperCase()} backup failed for ${name}: ${error.message}`);
      throw new Error(`${type.toUpperCase()} backup failed for ${name}: Command execution failed`);
    } finally {
      // Clean up temporary files
      if (tempConfigFile && fs.existsSync(tempConfigFile)) {
        fs.unlinkSync(tempConfigFile);
      }
      if (fs.existsSync(dumpFile)) {
        fs.unlinkSync(dumpFile);
      }
      if (fs.existsSync(tempArchivePath)) {
        fs.unlinkSync(tempArchivePath);
      }
    }
  }

  // MariaDB uses the same mysqldump command as MySQL
  async backupMariaDB(dbConfig, outputPath, timestamp) {
    return this.backupMySQL(dbConfig, outputPath, timestamp);
  }

  // Create compressed archive from SQL dump file
  async createCompressedArchive(sqlFile, archivePath, sqlFileName) {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(archivePath, { mode: 0o600 });
      const archive = archiver('tar', {
        gzip: true,
        gzipOptions: {
          level: 9
        }
      });
      
      output.on('close', () => {
        resolve();
      });
      
      output.on('error', reject);
      archive.on('error', reject);
      
      archive.pipe(output);
      
      // Add the SQL file to the archive with the proper name
      archive.file(sqlFile, { name: sqlFileName });
      
      archive.finalize();
    });
  }


  async backupDatabase(dbConfig, outputPath, timestamp) {
    switch (dbConfig.type) {
      case 'mysql':
        return this.backupMySQL(dbConfig, outputPath, timestamp);
      case 'mariadb':
        return this.backupMariaDB(dbConfig, outputPath, timestamp);
      default:
        throw new Error(`Unsupported database type: ${dbConfig.type}. Only MySQL and MariaDB are supported.`);
    }
  }

  async backupDatabases(databases, outputPath, timestamp) {
    const results = [];
    
    for (const database of databases) {
      try {
        const result = await this.backupDatabase(database, outputPath, timestamp);
        results.push(result);
      } catch (error) {
        this.logger.error(`Failed to backup database ${database.name}: ${error.message}`);
        throw error;
      }
    }
    
    return results;
  }
}

module.exports = DatabaseBackup;