import {
  closeSync,
  fsyncSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { randomUUID } from 'crypto';
import { basename, dirname, join } from 'path';

const DEFAULT_OPERATIONS = Object.freeze({
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
  unlinkSync,
});

function defaultCreateTempPath(filePath) {
  return join(
    dirname(filePath),
    `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
}

export function createAtomicFileWriter({
  operations = DEFAULT_OPERATIONS,
  createTempPath = defaultCreateTempPath,
} = {}) {
  const {
    openSync: openFile,
    writeFileSync: writeFile,
    fsyncSync: syncFile,
    closeSync: closeFile,
    renameSync: renameFile,
    unlinkSync: unlinkFile,
  } = operations;

  return function writeFileAtomic(filePath, content) {
    const tempPath = createTempPath(filePath);
    let fd = null;
    let ownsTempPath = false;

    try {
      fd = openFile(tempPath, 'wx');
      ownsTempPath = true;
      writeFile(fd, content);
      syncFile(fd);
      closeFile(fd);
      fd = null;
      renameFile(tempPath, filePath);
      ownsTempPath = false;
    } catch (error) {
      if (fd !== null) {
        try {
          closeFile(fd);
        } catch {
          // Best-effort close after a failed write.
        }
      }
      if (ownsTempPath) {
        try {
          unlinkFile(tempPath);
        } catch {
          // Best-effort cleanup only for the temp created by this invocation.
        }
      }
      throw error;
    }
  };
}

export const writeFileAtomic = createAtomicFileWriter();
