import protobuf from 'protobufjs';
import fs from 'node:fs';
const root=protobuf.loadSync('vendor/propresenter-7.11/presentation.proto');root.resolveAll();fs.writeFileSync('src/shared/propresenter-schema.json',JSON.stringify(root.toJSON()));console.log('Built pinned ProPresenter schema descriptor.');
