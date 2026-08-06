const { series, src, dest } = require('gulp');

const concat = require('gulp-concat');
const sass = require('gulp-sass')(require('sass'));


const paths = {
    css: [ "scss/tinyd6.scss" ]
};

const buildPaths = {
    css: "css"
}

function css()
{
    return src(paths.css)
        .pipe(concat('tinyd6.css'))
        .pipe(sass({ outputStyle: 'expanded', silenceDeprecations: ['legacy-js-api', 'import', 'global-builtin', 'slash-div', 'color-functions', 'abs-percent'] }))
        .pipe(dest(buildPaths.css));
}

exports.css = series(css);