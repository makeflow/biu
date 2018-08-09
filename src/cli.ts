#!/usr/bin/env node

import 'source-map-support/register';
import 'villa/platform/node';

import * as Path from 'path';
import * as Util from 'util';

import {CLI, Shim} from 'clime';

process.on('uncaughtException', exitWithError);
process.on('unhandledRejection', exitWithError);

let cli = new CLI('biu', Path.join(__dirname, 'commands'));

let shim = new Shim(cli);
shim.execute(process.argv).catch(exitWithError);

function exitWithError(error: any): void {
  process.stderr.write(`${Util.inspect(error)}\n`);
  process.exit(1);
}
