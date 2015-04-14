// Gulp plugin setup
var gulp = require('gulp');

// Watches single files
var watch = require('gulp-watch');
var gulpShopify = require('gulp-shopify-upload');

// Setup Shopify Theme and Private App credential
var shopify_key = '';
var shopify_pass = '';
var shopify_name = '';
var shopify_themeid = '';

var onError = function(err){ console.log(err) };
gulp.task('shopifywatch', function() {
    return watch('./+(assets|layout|config|snippets|templates|locales)/**')
    .pipe(gulpShopify(shopify_key, shopify_pass, shopify_name + '.myshopify.com', shopify_themeid))
});

// Default gulp action when gulp is run
gulp.task('default', [
        'shopifywatch'
]);
