// Shared wire-format filename; keep browser receipt checks and server storage equal.
export function safeTransferFilename(name){const safe=name.normalize('NFKC').split(/[\\/]/).pop().replace(/[<>:"|?*\x00-\x1f\x7f]/g,'_').replace(/[. ]+$/,'').slice(0,140);if(!safe||/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(safe))return 'presentation-'+safe;return safe;}
