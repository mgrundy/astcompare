'use strict';

var _ = require('underscore'),
    acorn = require('acorn'),
    cliArgs = require('command-line-args'),
    diff = require('deep-diff').diff,
    fs = require('fs'),
    path = require('path');

var cliDefaults = {
    jsFilesDir: ['jstests'],
};

var cli = cliArgs([
    {
        name: 'help',
        alias: 'h',
        type: Boolean,
        description: 'Print usage instructions',
    },
    {
        name: 'jsFilesDir',
        alias: 'j',
        type: String,
        multiple: true,
        description: 'List of subdirectories that contain the js files to analyze. Defaults to "' +
            cliDefaults.jsFilesDir + '"',
    },
    {
        name: 'modifiedSource',
        alias: 'm',
        type: String,
        description: 'Path to modified source tree',
    },
    {
        name: 'originalSource',
        alias: 'o',
        type: String,
        description: 'Path to unmodified source tree',
    },
    {
        name: 'verbose',
        alias: 'v',
        type: Boolean,
        description: 'Verbose mode',
    },
]);

var options = cli.parse();

// If a key from cliDefaults does not exist in options then use the default value.
_.defaults(options, cliDefaults);

var usage = cli.getUsage({
    header: process.env.npm_package_description ||
      'Compare the abstract syntax trees of js files in in one or more subdirectories of two trees',
});

if (options.help) {
    console.log(usage);
    process.exit(0);
}

function verbose() {
    if (options.verbose) {
        console.log.apply(console, arguments);
    }
}

// Assemble the list of files.
var idx = 0;
var files = [];
var directories = [];

// Create list of subdirectories to scan.

for (idx in options.jsFilesDir) {
    var subdir = options.jsFilesDir[idx];
    directories.push(path.join(options.originalSource, subdir));
}

verbose("List of directories to scan", directories);

// Work through the original source tree, we'll swap out the paths later.
while (directories.length) {
    var relativePath = directories.pop();
    verbose('Searching for files and directories in', relativePath);

    // Get all files and directories in this directory.
    var directoryChildren;
    try {
        directoryChildren = fs.readdirSync(relativePath);
    } catch (e) {
        console.error('Error accessing', relativePath);
        console.error(e);
        process.exit(1);
    }

    // Iterate through directoryChildren putting the JavaScript
    // files and directories into their respective arrays.
    _.each(directoryChildren, function(name) {
        var childRelativePath = path.join(relativePath, name);

        if (fs.statSync(childRelativePath).isDirectory()) {
            directories.push(childRelativePath);
        } else {
            if (path.extname(childRelativePath) === '.js') {
                files.push(childRelativePath);
            }
        }
    });
}

verbose(files.length, 'files found in the corpus');
verbose('Beginning AST parse process');

for (idx in files) {
    var originalVersion = files[idx];
    var modifiedVersion = path.normalize(originalVersion.replace(options.originalSource, options.modifiedSource));
    var originalAst;
    var modifiedAst;
    var parseOpts = {sourceType: 'script'};
    parseOpts = {ecmaVersion: 6, locations: true};

    verbose(originalVersion);
    verbose(modifiedVersion);

    try {
        // originalAst = esprima.parse(fs.readFileSync(originalVersion), parseOpts);
        originalAst = acorn.parse(fs.readFileSync(originalVersion), parseOpts);
    } catch (e) {
        console.error(originalVersion);
        throw e;
    }

    try {
        // modifiedAst = esprima.parse(fs.readFileSync(modifiedVersion), parseOpts);
        modifiedAst = acorn.parse(fs.readFileSync(modifiedVersion), parseOpts);
    } catch (e) {
        console.error(modifiedVersion);
        throw e;
    }

    // Acorn always puts start and end in the AST. We need to filter that out during the comparison.
    // And since we're filtering, we can add the loc data, which contains line numbers, for easier
    // post run analysis.
    var locsRegEx = new RegExp(/start|end|loc|start|line|column|end|line|column/);
    var differences = diff(originalAst,
                           modifiedAst,
                           function(key,path) {
                                return locsRegEx.test(path);
                           });

    verbose(JSON.stringify(differences));

    if (differences) {
        var outFilename = '.ast';
        var diffFilename = '.diff';
        var outPath1 = originalVersion + outFilename;
        var outPath2 = modifiedVersion + outFilename;
        var diffPath = outPath1 + diffFilename;

        console.error('AST variation detected in ' + originalVersion);

        // Write out the diff data and the AST for each version of the file.
        try {
            fs.writeFileSync(diffPath, JSON.stringify(differences, null, 4));
        } catch (e) {
            console.error('Error writing to', outPath1);
            console.error(e);
            process.exit(1);
        }
        try {
            fs.writeFileSync(outPath1, JSON.stringify(originalAst, null, 4));
        } catch (e) {
            console.error('Error writing to', outPath1);
            console.error(e);
            process.exit(1);
        }
        try {
            fs.writeFileSync(outPath2, JSON.stringify(modifiedAst, null, 4));
        } catch (e) {
            console.error('Error writing to', outPath2);
            console.error(e);
            process.exit(1);
        }

        console.error('AST dumps available in the following files:');
        console.error(outPath1);
        console.error(outPath2);
        console.error('Diff of AST dumps saved to:');
        console.error(diffPath, '\n');
    }
}
