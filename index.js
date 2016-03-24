'use strict';
var through = require('through2');
var gutil = require('gulp-util');
var inquirer = require("inquirer");
var path = require('path');
var isBinaryFile = require('isbinaryfile');
var ShopifyApi = require('shopify-api');
var opn = require('gulp-open');
var PluginError = gutil.PluginError;
var shopify = {};
var shopifyAPI;

var PLUGIN_NAME = 'gulp-shopify-upload';

// Set up shopify API information
shopify._api = false;
shopify._basePath = false;

/*
 * Get the Shopify API instance.
 *
 * @return {ShopifyApi}
 */
shopify._getApi = function (apiKey, password, host) {
  if (!shopify._api) {
    var opts = {
      auth: apiKey + ':' + password,
      host: host,
      port: '443',
      timeout: 120000
    };

    shopify._api = new ShopifyApi(opts);
  }

  return shopify._api;
};

/*
 * Convert a file path on the local file system to an asset path in shopify
 * as you may run gulp at a higher directory locally.
 *
 * The original path to a file may be something like shop/assets/site.css
 * whereas we require assets/site.css in the API. To customize the base
 * set shopify.options.base config option.
 *
 * @param {string}
 * @return {string}
 */
shopify._makeAssetKey = function (filepath, base) {
  filepath = shopify._makePathRelative(filepath, base);

  return encodeURI(filepath);
};

/*
 * Get the base path.
 *
 * @return {string}
 */
shopify._getBasePath = function (filebase) {
  if (!shopify._basePath) {
    var base = filebase;

    shopify._basePath = (base.length > 0) ? path.resolve(base) : process.cwd();
  }

  return shopify._basePath;
};

/**
 * Sets the base path
 *
 * @param {string} basePath
 * @return {void}
 */
shopify._setBasePath = function (basePath) {
  shopify._basePath = basePath;
};

/**
 * Make a path relative to base path.
 *
 * @param {string} filepath
 * @return {string}
 */
shopify._makePathRelative = function (filepath, base) {
  var basePath = shopify._getBasePath(base);

  filepath = path.relative(basePath, filepath);

  return filepath.replace(/\\/g, '/');
};

/**
 * Applies options to plugin
 *
 * @param {object} options
 * @return {void}
 */
shopify._setOptions = function (options) {
  if (!options) {
    return;
  }

  if (options.hasOwnProperty('basePath')) {
    shopify._setBasePath(options.basePath);
  }
};

/*
 * Upload a given file path to Shopify
 *
 * Assets need to be in a suitable directory.
 *      - Liquid templates => 'templates/'
 *      - Liquid layouts => 'layout/'
 *      - Liquid snippets => 'snippets/'
 *      - Theme settings => 'config/'
 *      - General assets => 'assets/'
 *      - Language files => 'locales/'
 *
 * Some requests may fail if those folders are ignored
 * @param {filepath} string - filepath
 * @param {file} string - file name
 * @param {host} string- Shopify URL
 * @param {base} sting - options.basePath
 * @param {themeid} string - Shopify theme
 */
shopify.upload = function (filepath, file, host, base, themeid, cb) {

  var api = shopifyAPI;
  var key = shopify._makeAssetKey(filepath, base);
  var isBinary = isBinaryFile(filepath);
  var contents;
  var props = {
    asset: {
      key: key
    }
  };

  contents = file.contents;

  if (isBinary) {
    props.asset.attachment = contents.toString('base64');
  } else {
    props.asset.value = contents.toString();
  }

  gutil.log(gutil.colors.gray.dim('Uploading: ' + filepath));
  function onUpdate(err, resp) {
    if (err && err.type === 'ShopifyInvalidRequestError') {
      gutil.log(gutil.colors.red('Error uploading file ' + filepath ));
    } else if (!err) {
      var filename = filepath.replace(/^.*[\\\/]/, '');
      gutil.log(gutil.colors.green('Upload Complete: ' + filename));
    } else {
      gutil.log(gutil.colors.red('Error undefined! ' + err.type + ' ' + err.detail ));
    }
    cb();
  }

  if (themeid) {
    api.asset.update(themeid, props, onUpdate);
  } else {
    api.assetLegacy.update(props, onUpdate);
  }
};


/*
 * Remove a given file path from Shopify.
 *
 * File should be the relative path on the local filesystem.
 *
 * @param {filepath} string - filepath
 * @param {file} string - file name
 * @param {host} string- Shopify URL
 * @param {base} sting - options.basePath
 * @param {themeid} string - Shopify theme
 */
shopify.destroy = function (filepath, file, host, base, themeid, cb) {

  var api = shopifyAPI;
  var key = shopify._makeAssetKey(filepath, base);

  gutil.log(gutil.colors.gray.dim('Removing file: ' + filepath));

  function onDestroy(err, resp) {
    if (err && err.type === 'ShopifyInvalidRequestError') {
      gutil.log(gutil.colors.red('Error removing file: ' + filepath ));
    } else if (!err) {
      var filename = filepath.replace(/^.*[\\\/]/, '');
      gutil.log(gutil.colors.green('File removed: ' + filename));
    } else {
      gutil.log(gutil.colors.red('Error undefined! ' + err.type));
    }
    cb();
  }

  if (themeid) {
    api.asset.destroy(themeid, key, onDestroy);
  } else {
    api.assetLegacy.destroy(key, onDestroy);
  }
};


/*
 * Public function for process deployment queue for new files added via the stream.
 * The queue is processed based on Shopify's leaky bucket algorithm that allows
 * for infrequent bursts calls with a bucket size of 40. This regenerates overtime,
 * but offers an unlimited leak rate of 2 calls per second. Use this variable to
 * keep track of api call rate to calculate deployment.
 * https://docs.shopify.com/api/introduction/api-call-limit
 *
 * @param {apiKey} string - Shopify developer api key
 * @param {password} string - Shopify developer api key password
 * @param {host} string - hostname provided from gulp file
 * @param {themeid} string - unique id upload to the Shopify theme
 * @param {options} object - named array of custom overrides.
 */
function gulpShopifyUpload(apiKey, password, host, themeid, options, themeName) {

  // queue files provided in the stream for deployment
  var apiBurstBucketSize = 36;
  var fileCount = 0;
  var stream;

  // Set up the API
  shopify._setOptions(options);
  shopifyAPI = shopify._getApi(apiKey, password, host);

  if (typeof apiKey === 'undefined') {
    throw new PluginError(PLUGIN_NAME, 'Error, API Key for shopify does not exist!');
  }
  if (typeof password === 'undefined') {
    throw new PluginError(PLUGIN_NAME, 'Error, password for shopify does not exist!');
  }
  if (typeof host === 'undefined') {
    throw new PluginError(PLUGIN_NAME, 'Error, host for shopify does not exist!');
  }

  var themes = [];

  // List available themes if options.listThemes is true
  if (options.listThemes) {
    shopifyAPI.theme.list(function(err, obj) {
      if (err || !obj.themes ) {
        gutil.log(gutil.colors.red( err ));
        return;
      } else {
        // We have multiple themes, lets list them for easy reference to the themeid
        // without having to look in the admin
        obj.themes.forEach(function(theme) {
          var t = theme.id + ' - ' + theme.name;
          if (theme.role.length > 0) {
            t += ' (' + theme.role + ')';
          }
          themes.push(t);
          // gutil.log( 'Available theme: ' + gutil.colors.magenta( t ));
          // if ( theme.id == themeid ){
          //   gutil.log( gutil.colors.green('Connected to ') + gutil.colors.magenta(host) + gutil.colors.green(' theme: ') + gutil.colors.magenta( t ));
          // }
        });
      }
    });
  } else {
    // If the listThemes option isnt set or is false, still show theme ID if we can
    if (themeid) {
      gutil.log('Connected to ' + gutil.colors.magenta(host) + ' theme: ' + gutil.colors.magenta(themeid));
    } else {
      gutil.log('Connected to ' + gutil.colors.magenta(host));
    }
  }

  inquirer.prompt([
    {
      type: 'list',
      name: 'theme',
      message: 'which theme would you like to use?',
      choices: themes
    }
  ], function( answers ) {
    console.log( JSON.stringify(answers, null, '  ') );
  });


  // gulp.src('').pipe(open({uri: envUrl}));

  // gutil.log(
  //   '\n' +
  //   '\n' + gutil.colors.dim.underline('Ready to upload to...                   ') +
  //   '\n' + gutil.colors.dim('Environment Name: ') + '  ' + gutil.colors.bold.green(themeName) +
  //   '\n' + gutil.colors.dim('Store URL: ') + '         ' + gutil.colors.bold.green(host) +
  //   '\n' + gutil.colors.dim('Theme ID: ') + '          ' + gutil.colors.bold.green(themeid) +
  //   '\n'
  // );

  // creating a stream through which each file will pass
  stream = through.obj(function (file, enc, cb) {
    if (file.isStream()) {
      this.emit('error', new PluginError(PLUGIN_NAME, 'Streams are not supported!'));
      return cb();
    }

    var self = this;

    if (file.isBuffer()) {
      // deploy immediately if within the burst bucket size, otherwise queue
      if (fileCount <= apiBurstBucketSize) {
        shopify.upload(file.path, file, host, '', themeid, function() {
          self.push(file);
          cb();
        });
      } else {
        // Delay deployment based on position in the array to deploy 2 files per second
        // after hitting the initial burst bucket limit size
        setTimeout(shopify.upload.bind(null, file.path, file, host, '', themeid, function() {
          self.push(file);
          cb();
        }), ((fileCount - apiBurstBucketSize) / 2) * 1000);
      }
      fileCount++;
    }

    // If file is removed locally, destroy it on Shopify
    if (file.isNull()) {
      // Remove immediately if within the burst bucket size, otherwise queue
      if (fileCount <= apiBurstBucketSize) {
        shopify.destroy(file.path, file, host, '', themeid, function(){
          self.push(file);
          cb();
        });
      } else {
        // Delay removal based on position in the array to deploy 2 files per second
        // after hitting the initial burst bucket limit size
        setTimeout(shopify.destroy.bind(null, file.path, file, host, '', themeid, function() {
          self.push(file);
          cb();
        }), ((fileCount - apiBurstBucketSize) / 2) * 1000);
      }
      fileCount++;
    }

  });

  // returning the file stream
  return stream;
}

// exporting the plugin main function
module.exports = gulpShopifyUpload;