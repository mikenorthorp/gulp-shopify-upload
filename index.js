var through = require('through2');
var gutil = require('gulp-util');
var path = require('path');
var async = require('async');
var isBinaryFile = require('isbinaryfile');
var ShopifyApi = require('shopify-api');
var PluginError = gutil.PluginError;

// Set up shopify API information
var shopify = {};
shopify._api = false;
shopify._basePath = false;

// Store the connection here
var shopifyAPI;

// consts
const PLUGIN_NAME = 'gulp-shopify-upload';

/*
 * Get the Shopify API instance.
 *
 * @return {ShopifyApi}
 */
shopify._getApi = function(apiKey, password, host) {
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
* as you may run grunt at a higher directory locally.
*
* The original path to a file may be something like shop/assets/site.css
* whereas we require assets/site.css in the API. To customize the base
* set shopify.options.base config option.
*
* @param {string}
* @return {string}
*/
shopify._makeAssetKey = function(filepath, base) {
  filepath = shopify._makePathRelative(filepath, base);

  return encodeURI(filepath);
};

/*
* Get the base path.
*
* @return {string}
*/
shopify._getBasePath = function(filebase) {
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
shopify._setBasePath = function(basePath) {
  shopify._basePath = basePath;
};

/**
* Make a path relative to base path.
*
* @param {string} filepath
* @return {string}
*/
shopify._makePathRelative = function(filepath, base) {
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
shopify._setOptions = function(options) {
  if(!options){
    return;
  }

  if(options.hasOwnProperty("basePath")){
    shopify._setBasePath(options.basePath);
  }
};

/*
 * Upload a given file path to Shopify
 *
 * Assets need to be in a suitable directory.
 *      - Liquid templates => "templates/"
 *      - Liquid layouts => "layout/"
 *      - Liquid snippets => "snippets/"
 *      - Theme settings => "config/"
 *      - General assets => "assets/"
 *      - Language files => "locales/"
 *
 * Some requests may fail if those folders are ignored
 * @param {string} filepath
 * @param {Function} done
 */
shopify.upload = function(filepath, file, host, base, themeid) {

    var api = shopifyAPI,
        themeId = themeid,
        key = shopify._makeAssetKey(filepath, base),
        isBinary = isBinaryFile(filepath),
        props = {
            asset: {
                key: key
            }
        },
        contents;

    contents = file.contents;

    if (isBinary) {
        props.asset.attachment = contents.toString('base64');
    } else {
        props.asset.value = contents.toString();
    }

    function onUpdate(err, resp) {
        if (err && err.type === 'ShopifyInvalidRequestError') {
            console.log('Error invalid upload request! ' + filepath + ' not uploaded to ' + host);
        } else if (!err) {
            var filename = filepath.replace(/^.*[\\\/]/, '');
            console.log('Upload Complete: ' + filename);
        } else {
          console.log('Error undefined! ' + err.type);
        }
    }

    if (themeId) {
      api.asset.update(themeId, props, onUpdate);
    } else {
      api.assetLegacy.update(props, onUpdate);
    }
};


// plugin level function (dealing with files)
function gulpShopifyUpload(apiKey, password, host, themeid, options) {

  // Set up the API
  shopify._setOptions(options);
  shopifyAPI = shopify._getApi(apiKey, password, host);

  console.log('Ready to upload too ' + host);

  if(typeof apiKey === 'undefined'){
    throw new PluginError(PLUGIN_NAME, 'Error, API Key for shopify does not exist!');
  };
  if(typeof password === 'undefined'){
    throw new PluginError(PLUGIN_NAME, 'Error, password for shopify does not exist!');
  };
  if(typeof host === 'undefined'){
    throw new PluginError(PLUGIN_NAME, 'Error, host for shopify does not exist!');
  };

  // creating a stream through which each file will pass
  var stream = through.obj(function(file, enc, cb) {
    if (file.isStream()) {
      this.emit('error', new PluginError(PLUGIN_NAME, 'Streams are not supported!'));
      return cb();
    }

    if (file.isBuffer()) {
      shopify.upload(file.path, file, host, '', themeid);
    }

    // make sure the file goes through the next gulp plugin
    this.push(file);

    // tell the stream engine that we are done with this file
    cb();
  });

  // returning the file stream
  return stream;
};

// exporting the plugin main function
module.exports = gulpShopifyUpload;
