# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Node.js CLI tool and library for backing up directories and MySQL/MariaDB databases to Amazon S3. The project uses a modular architecture with separate classes for each major function: directory backup, database backup, S3 uploading, and configuration management.

## Setup and Usage Steps

### 1. Installation
```bash
npm install
```

### 2. Configuration Setup
```bash
# Copy the example configuration file
cp backup-config.example.json backup-config.json

# Edit backup-config.json with your actual values:
# - S3 credentials (accessKeyId, secretAccessKey, bucket, region)
# - Directory paths to backup  
# - Database connection details (including passwords)
# - Retention policies

# IMPORTANT: Set secure permissions on config file
chmod 600 backup-config.json
```

### 3. Git Protection (CRITICAL)
```bash
# The system will automatically check and warn you if backup-config.json
# is not in .gitignore to prevent accidental credential commits

# If needed, manually add to .gitignore:
echo "backup-config.json" >> .gitignore
```

### 4. Prerequisites
Ensure required database tools are installed:
```bash
# For MySQL/MariaDB backups
which mysqldump

# Verify MySQL/MariaDB client tools are available
mysql --version
# or
mariadb --version
```

### 5. S3-Compatible Storage Setup
The tool supports any S3-compatible storage service:

**AWS S3:**
- Create S3 bucket with appropriate permissions
- Ensure IAM user has: s3:PutObject, s3:GetObject, s3:DeleteObject, s3:ListBucket

**Other S3-Compatible Services:**
- DigitalOcean Spaces: Set endpoint to `https://REGION.digitaloceanspaces.com`
- Wasabi: Set endpoint to `https://s3.wasabisys.com` 
- Backblaze B2: Set endpoint to `https://s3.REGION.backblazeb2.com`
- Cloudflare R2: Set endpoint to `https://ACCOUNT_ID.r2.cloudflarestorage.com`
- MinIO: Set endpoint to your MinIO server URL and `forcePathStyle: true`

See `s3-compatible-examples.json` for complete configuration examples.

### 5. Running Backups
```bash
# Test configuration first
npx backup-to-s3 validate -c backup-config.json

# Run backup
npx backup-to-s3 backup -c backup-config.json

# Run with verbose logging
npx backup-to-s3 backup -c backup-config.json -v

# List existing S3 backups
npx backup-to-s3 list -c backup-config.json
```

### 6. Scheduling Backups
Use system cron to schedule regular backups:
```bash
# Edit crontab
crontab -e

# Add entry for daily backup at 2 AM
0 2 * * * /usr/bin/npx backup-to-s3 backup -c /path/to/backup-config.json

# Add entry for weekly backup every Sunday at 3 AM
0 3 * * 0 /usr/bin/npx backup-to-s3 backup -c /path/to/backup-config.json
```

## Common Commands

```bash
# Install dependencies
npm install

# Run the CLI tool
node src/cli.js backup -c backup-config.json
# or via npm script
npm start backup -c backup-config.json

# Validate configuration
npx backup-to-s3 validate -c backup-config.json

# List existing S3 backups
npx backup-to-s3 list -c backup-config.json

# Run with verbose logging
npx backup-to-s3 backup -c backup-config.json -v

# Test configuration (no actual test framework configured)
npm test
```

## Architecture

### Core Classes and Data Flow

1. **BackupManager** (`src/index.js`) - Main orchestrator class that coordinates the entire backup process
   - Loads configuration via `config.js`
   - Creates temporary directory for backup files
   - Coordinates directory and database backups
   - Handles S3 uploads and cleanup
   - Manages error handling and logging throughout

2. **Configuration System** (`src/config.js`) - Uses Joi schema validation
   - Validates S3 credentials (region, bucket, accessKeyId, secretAccessKey)
   - Validates directory configs (name, path, exclude patterns)
   - Validates database configs (supports MySQL, PostgreSQL, MongoDB with different schemas)
   - Validates backup settings (retention, compression, timestamps)

3. **Directory Backup** (`src/directory-backup.js`) - Archives directories
   - Uses `archiver` to create tar.gz files
   - Supports glob-based exclusion patterns
   - Compresses files during archival process

4. **Database Backup** (`src/database-backup.js`) - Database export functionality
   - **MySQL**: Uses `mysqldump` command-line tool with secure config files
   - **MariaDB**: Uses same `mysqldump` command with MariaDB-specific optimizations  
   - Supports both direct password and config file authentication
   - Creates compressed tar.gz archives containing SQL dumps (consistent with directory backups)
   - All database backups are saved to secure temporary files before compression and S3 upload
   - Automatic cleanup of temporary config files and intermediate files

5. **S3 Uploader** (`src/s3-uploader.js`) - S3 integration and lifecycle management
   - Uploads files with server-side encryption (AES256)
   - Organizes backups with timestamp-based S3 keys
   - Implements retention policy cleanup (daily/weekly/monthly)
   - Lists and deletes old backups based on age

6. **CLI Interface** (`src/cli.js`) - Commander.js-based CLI
   - Three main commands: backup, validate, list
   - Supports verbose and quiet modes
   - Handles configuration file path resolution

### Configuration Structure

The system expects a JSON configuration with these sections:
- `s3`: S3-compatible storage credentials and connection details
  - Required: `region`, `bucket`, `accessKeyId`, `secretAccessKey`
  - Optional: `endpoint`, `forcePathStyle` (for non-AWS services), `signatureVersion`
- `directories`: Array of directory backup configurations with exclusion patterns
- `databases`: Array of database configurations (type-specific schemas)
- `backup`: Retention policies, compression settings, timestamp options

### S3-Compatible Service Support

The S3Uploader class automatically configures itself for different S3-compatible services:
- **AWS S3**: No endpoint required (uses default AWS endpoints)
- **Custom endpoints**: When `endpoint` is provided, enables S3-compatible mode
- **Path-style URLs**: `forcePathStyle: true` for services like MinIO that require path-style URLs
- **Signature versions**: Defaults to v4, configurable via `signatureVersion`

### Temporary File Handling

- All backups are created in secure temporary directories before S3 upload
- Directory backups: compressed directly to .tar.gz archives
- Database backups: SQL dumps created first, then compressed to .tar.gz archives
- Temporary files are automatically cleaned up after successful upload
- Cleanup happens in `finally` block to ensure removal even on errors
- All temporary files created with restrictive 600 permissions

### S3 Organization Structure

Backups are organized in S3 with a project-based hierarchy:
- All backups are stored under the project name folder
- Directory backups: `project-name/directory-name/directory-name_YYYY-MM-DD_HH-MM-SS.tar.gz`
- Database backups: `project-name/database-name/database-name_YYYY-MM-DD_HH-MM-SS.tar.gz`
- Both types use compressed tar.gz format for consistency
- Each backup type gets its own subfolder within the project
- Timestamps are automatically included in all filenames
- All backups in a single session share the same timestamp

Example S3 structure:
```
s3://my-backup-bucket/
└── my-project/
    ├── web-assets/
    │   └── web-assets_2024-01-15_14-30-25.tar.gz
    ├── user-uploads/
    │   └── user-uploads_2024-01-15_14-30-25.tar.gz  
    ├── mysql-db/
    │   └── mysql-db_2024-01-15_14-30-25.tar.gz (contains mysql-db_2024-01-15_14-30-25.sql)
    └── mariadb-db/
        └── mariadb-db_2024-01-15_14-30-25.tar.gz (contains mariadb-db_2024-01-15_14-30-25.sql)
```

**Benefits of Project Organization:**
- Multiple projects can share the same S3 bucket
- Retention policies operate per-project
- Easy to manage different environments (dev, staging, prod)
- Clear separation of concerns for different applications

**Timestamp Benefits:**
- All backups in a session have consistent timestamp
- Easy to identify related backups from the same backup run
- Historical tracking of backup frequency
- Prevents filename conflicts for multiple daily backups
- Format: `YYYY-MM-DD_HH-MM-SS` (e.g., `2024-01-15_14-30-25`)

### External Dependencies

The system requires external command-line tools for database backups:
- `mysqldump` for MySQL databases
- `pg_dump` for PostgreSQL databases  
- `mongodump` for MongoDB databases

### Error Handling Pattern

Each major component throws specific errors that bubble up to BackupManager, which logs them via Winston and re-throws for CLI handling. The CLI catches all errors and exits with appropriate status codes.