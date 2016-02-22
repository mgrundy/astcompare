'use strict';

var _ = require('underscore'),
    acorn = require('acorn'),
    cliArgs = require('command-line-args'),
    diff = require('deep-diff').diff,
    fs = require('fs'),
    path = require('path'),
    observableDiff = require('deep-diff').observableDiff;

var cliDefaults = {
    debug: false,
    jsFilesDir: ['jstests'],
};

var cli = cliArgs([
    {
        name: 'debug',
        alias: 'd',
        type: Boolean,
        description: 'Save AST dumps and a diff file for any file sets containing different ASTs.',
    },
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
      'Compare the abstract syntax trees of js files in one or more subdirectories of two trees',
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
for (var subdir of options.jsFilesDir) {
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
        } else if(fs.statSync(childRelativePath).isFile()) { 
            if (path.extname(childRelativePath) === '.js') {
                files.push(childRelativePath);
            }
        } else {
            // If for some reason the directory tree contains sockets, pipes
            // or devices, ignore them. But log in verbose mode.
            verbose(childRelativePath, " is not a normal file or directory");
        }
    });
}

verbose(files.length, 'files found in the corpus');
verbose('Beginning AST parse process');

for (var originalVersion of files) {
    var modifiedVersion = path.normalize(originalVersion.replace(options.originalSource, options.modifiedSource));
    var originalAst;
    var modifiedAst;
    var parseOpts = {sourceType: 'script'};
    parseOpts = {ecmaVersion: 6, locations: true};

    verbose(originalVersion);
    verbose(modifiedVersion);

    try {
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
    var locsRegEx = new RegExp(/column|end|line|loc|start/);
    var differences = diff(originalAst,
                           modifiedAst,
                           function(key,path) {
                                return locsRegEx.test(path);
                           });

    verbose(JSON.stringify(differences));

    if (differences) {
        var astOutExt = '.ast';
        var astDiffExt = '.diff';
        var astFilePathOriginal = originalVersion + astOutExt;
        var astFilePathModified = modifiedVersion + astOutExt;
        var astDiffFilePath = astFilePathOriginal + astDiffExt;

        console.error('AST variation detected in ' + originalVersion);

        for (var diffEntry of differences) {
            if (diffEntry.lhs && diffEntry.lhs.loc) {
                console.error("Orignal:", diffEntry.lhs.loc);
            }
            if (diffEntry.rhs && diffEntry.rhs.loc) {
                console.error("Modified:", diffEntry.rhs.loc);
            }
        }
        if (options.debug) {
            // Write out the diff data and the AST for each version of the file.
            try {
                fs.writeFileSync(astDiffFilePath, JSON.stringify(differences, null, 4));
            } catch (e) {
                console.error('Error writing to', astFilePathOriginal);
                console.error(e);
                process.exit(1);
            }
            try {
                fs.writeFileSync(astFilePathOriginal, JSON.stringify(originalAst, null, 4));
            } catch (e) {
                console.error('Error writing to', astFilePathOriginal);
                console.error(e);
                process.exit(1);
            }
            try {
                fs.writeFileSync(astFilePathModified, JSON.stringify(modifiedAst, null, 4));
            } catch (e) {
                console.error('Error writing to', astFilePathModified);
                console.error(e);
                process.exit(1);
            }

            console.error('AST dumps available in the following files:');
            console.error(astFilePathOriginal);
            console.error(astFilePathModified);
            console.error('Diff of AST dumps saved to:');
            console.error(astDiffFilePath, '\n');
        } else {
            console.error('Use the -d option to save AST dumps and diff info.');
        }
    }
}
