import guard from '../desktop/build-release-guard.cjs';
try {
 await guard.requireBuildsAllowed();
 console.log('Stați build release is clear.');
} catch(error) {
 console.error(error.message);
 process.exitCode=1;
}
