#!/usr/bin/env node

const { Command } = require('commander');
const path = require('path');
const BackupManager = require('./index');
const { createLogger } = require('./logger');

const program = new Command();

program
  .name('backup-to-s3')
  .description('Configurable backup tool for directories and databases to S3')
  .version('1.0.0');

program
  .command('backup')
  .description('Run backup using configuration file')
  .option('-c, --config <path>', 'Path to configuration file', './backup-config.json')
  .option('-v, --verbose', 'Enable verbose logging')
  .option('-q, --quiet', 'Suppress all output except errors')
  .action(async (options) => {
    const configPath = path.resolve(options.config);
    
    const loggerOptions = {
      level: options.quiet ? 'error' : (options.verbose ? 'debug' : 'info'),
      silent: false
    };
    
    try {
      const backupManager = new BackupManager(configPath, { logger: loggerOptions });
      const result = await backupManager.runBackup();
      
      if (result.success) {
        console.log(`✅ Backup completed successfully!`);
        console.log(`📦 Processed ${result.backups} backups`);
        console.log(`📊 Total size: ${(result.totalSize / 1024 / 1024).toFixed(2)} MB`);
        console.log(`🚀 Uploaded ${result.uploads.length} files to S3`);
      }
      
      process.exit(0);
    } catch (error) {
      console.error(`❌ Backup failed: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('validate')
  .description('Validate configuration file')
  .option('-c, --config <path>', 'Path to configuration file', './backup-config.json')
  .action(async (options) => {
    const configPath = path.resolve(options.config);
    
    try {
      const { loadConfig } = require('./config');
      const config = loadConfig(configPath);
      console.log('✅ Configuration is valid');
      console.log(`📁 Directories: ${config.directories.length}`);
      console.log(`🗄️  Databases: ${config.databases.length}`);
      console.log(`☁️  S3 Bucket: ${config.s3.bucket}`);
      process.exit(0);
    } catch (error) {
      console.error(`❌ Configuration validation failed: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List existing backups in S3')
  .option('-c, --config <path>', 'Path to configuration file', './backup-config.json')
  .action(async (options) => {
    const configPath = path.resolve(options.config);
    
    try {
      const { loadConfig } = require('./config');
      const config = loadConfig(configPath);
      const { S3Uploader } = require('./s3-uploader');
      const logger = createLogger();
      
      const uploader = new S3Uploader(config.s3, logger);
      const backups = await uploader.listBackups();
      
      console.log(`📦 Found ${backups.length} backups in S3:`);
      backups.forEach(backup => {
        const date = new Date(backup.LastModified).toLocaleDateString();
        const size = (backup.Size / 1024 / 1024).toFixed(2);
        console.log(`  ${backup.Key} (${size} MB, ${date})`);
      });
      
      process.exit(0);
    } catch (error) {
      console.error(`❌ Failed to list backups: ${error.message}`);
      process.exit(1);
    }
  });

if (process.argv.length === 2) {
  program.help();
}

program.parse();