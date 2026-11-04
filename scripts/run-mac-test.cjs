// Run the real station against the live service in a separate Mac test profile.
const {app}=require('electron');
const path=require('node:path');
if(process.platform!=='darwin')throw new Error('This launcher is for Mac testing. Use the Windows installer on Windows.');
app.setName('Stați Mac Test');
app.setPath('userData',path.join(app.getPath('appData'),'Hapi Products','Stati Mac Test'));
require('../desktop/main.cjs');

// QA-only appearance override; the installed app always follows the device.
if(process.argv.includes('--stati-test-light'))app.whenReady().then(()=>{require('electron').nativeTheme.themeSource='light';});
