require('./local-review-env.cjs');
process.argv = ['node', 'next', 'dev', '--hostname', '127.0.0.1'];
require('next/dist/bin/next');
