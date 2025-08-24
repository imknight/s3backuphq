const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadConfig } = require('./config');
const DirectoryBackup = require('./directory-backup');
const DatabaseBackup = require('./database-backup');
const S3Uploader = require('./s3-uploader');
const { createLogger } = require('./logger');
const { generateTimestamp } = require('./utils');

class BackupManager {
  constructor(configPath, options = {}) {
    this.startTime = new Date();
    this.config = loadConfig(configPath);
    this.logger = createLogger(options.logger);
    this.tempDir = path.join(os.tmpdir(), 'backup-to-s3');
    
    this.directoryBackup = new DirectoryBackup(this.logger);
    this.databaseBackup = new DatabaseBackup(this.logger);
    this.s3Uploader = new S3Uploader(this.config.s3, this.config.project.name, this.logger);
  }

  async ensureTempDir() {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  async cleanup() {
    try {
      if (fs.existsSync(this.tempDir)) {
        fs.rmSync(this.tempDir, { recursive: true, force: true });
      }
    } catch (error) {
      this.logger.warn(`Failed to cleanup temp directory: ${error.message}`);
    }
  }

  async runBackup() {
    try {
      this.logger.info('Starting backup process...');
      
      // Generate single timestamp for all backups in this session
      const backupTimestamp = generateTimestamp(this.startTime);
      this.logger.info(`Backup timestamp: ${backupTimestamp}`);
      
      await this.ensureTempDir();
      
      const allBackups = [];
      
      if (this.config.directories.length > 0) {
        this.logger.info(`Backing up ${this.config.directories.length} directories...`);
        const directoryBackups = await this.directoryBackup.backupDirectories(
          this.config.directories, 
          this.tempDir,
          backupTimestamp
        );
        allBackups.push(...directoryBackups);
      }
      
      if (this.config.databases.length > 0) {
        this.logger.info(`Backing up ${this.config.databases.length} databases...`);
        const databaseBackups = await this.databaseBackup.backupDatabases(
          this.config.databases, 
          this.tempDir,
          backupTimestamp
        );
        allBackups.push(...databaseBackups);
      }
      
      if (allBackups.length === 0) {
        this.logger.warn('No backups to process');
        return { success: true, uploads: [] };
      }
      
      this.logger.info(`Uploading ${allBackups.length} backups to S3...`);
      const uploads = await this.s3Uploader.uploadBackups(
        allBackups, 
        this.config.backup.timestamp
      );
      
      if (this.config.backup.retention) {
        this.logger.info('Running retention cleanup...');
        await this.s3Uploader.cleanupOldBackups(this.config.backup.retention);
      }
      
      this.logger.info('Backup process completed successfully');
      
      return {
        success: true,
        backups: allBackups.length,
        uploads,
        totalSize: uploads.reduce((sum, upload) => sum + upload.size, 0)
      };
      
    } catch (error) {
      this.logger.error(`Backup failed: ${error.message}`);
      throw error;
    } finally {
      await this.cleanup();
    }
  }
}

module.exports = BackupManager;