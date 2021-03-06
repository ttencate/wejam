'use strict'

/**
 * Entry point for the WeJam! game jam system
 *
 * @description
 * Starts the Node server
 *
 * @module wejam
 */

let log
try {
  log = global.log = require('./core/log')
  log.info('Starting server...')
} catch (e) {
  console.error('Failed to start the server: ' + e.message)
  console.error('Did you run "npm install"?')
  return
}

const promisify = require('promisify-node')
const fs = promisify('fs')
const path = require('path')
const express = require('express')
const browserRefreshClient = require('browser-refresh-client')

createApp()

/*
 * Create, configure and launch the server
 */
async function createApp () {
  catchErrorsAndSignals()
  await initFilesLayout()

  const middleware = require('./core/middleware')
  const config = require('./config')

  let app = express()
  app.locals.devMode = app.get('env') === 'development'
  await initDatabase(app.locals.devMode)
  await middleware.configure(app)
  app.listen(config.SERVER_PORT, configureBrowserRefresh)
  log.info('Server started on port ' + config.SERVER_PORT + '.')
}

/*
 * Catch unhandled errors and system signals
 */
function catchErrorsAndSignals () {
  // Display unhandled rejections more nicely
  process.on('unhandledException', (e) => {
    log.error('Unhandled promise rejection:', e)
    _doGracefulShutdown()
  })
  process.on('unhandledRejection', (reason, p) => {
    log.error('Unhandled promise rejection:', p)
  })

  // Stop the server gracefully upon shut down signals
  // XXX Doesn't work on Windows
  let signals = ['SIGINT', 'SIGQUIT', 'SIGTERM']
  signals.forEach((signal) => {
    process.on(signal, _doGracefulShutdown)
  })
  function _doGracefulShutdown (cb) {
    const db = require('./core/db')
    log.info('Shutting down.')
    db.knex.destroy(() => process.exit(-1))
  }
}

/*
 * Initialize files upon first startup
 */
async function initFilesLayout () {
  // Create config.js if missing
  const CONFIG_PATH = './config.js'
  const CONFIG_SAMPLE_PATH = './config.sample.js'
  try {
    await fs.access(CONFIG_PATH, fs.constants.R_OK)
  } catch (e) {
    let sampleConfig = await fs.readFile(CONFIG_SAMPLE_PATH)
    await fs.writeFile(CONFIG_PATH, sampleConfig)
    log.info(CONFIG_PATH + ' initialized with sample values')
  }

  // Create data folders
  const config = require('./config')
  const fileStorage = require('./core/file-storage')
  await fileStorage.createFolderIfMissing(path.join(config.DATA_PATH, '/tmp'))
  await fileStorage.createFolderIfMissing(config.UPLOADS_PATH)
}

/*
 * DB initialization
 */
async function initDatabase (withSamples) {
  const db = require('./core/db')
  let currentVersion = await db.findCurrentVersion()
  if (currentVersion > 0) {
    log.info('Database found in version ' + currentVersion + '.')
  } else {
    log.info('Empty database found.')
  }

  await db.upgradeTables(currentVersion)
  if (currentVersion === 0 && withSamples) {
    await db.insertSamples()
  }
  let newVersion = await db.findCurrentVersion()
  if (newVersion > currentVersion) {
    log.info('Database upgraded to version ' + newVersion + '.')
  } else {
    log.info('No database upgrade needed.')
  }
}

/*
 * Use browser-refresh to refresh the browser automatically during development
 */
function configureBrowserRefresh () {
  const config = require('./config.js')

  if (process.send && config.DEBUG_REFRESH_BROWSER) {
    process.send('online')
    browserRefreshClient
      .enableSpecialReload('*.html *.css *.png *.jpeg *.jpg *.gif *.svg',
        { autoRefresh: false })
      .onFileModified(() => browserRefreshClient.refreshPage())
  }
}
