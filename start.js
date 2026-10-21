import {errorCode,logEvent,startupPhase} from './runtime-diagnostics.js';

const fatal=error=>{logEvent('process_failed',{code:errorCode(error)},'error');process.exit(1);};
process.once('uncaughtException',fatal);
process.once('unhandledRejection',fatal);
startupPhase('module_import');
try{await import('./server.js');}catch(error){fatal(error);}
