-- Exact pre-change chunk INSERT SQL, with template guards expanded.
-- Source: src/server/station-catalog.ts in service-workflows_2026-10-25/before-source.tar.gz
-- Archive SHA-256: 6fd3977c10876da515d22e4a83c758df3f7217a1305754e7c054d01f448ac82d
INSERT INTO station_catalog_staging(device_id,song_id,title,content_hash,filename,category,language,font_size,text,first_slide,added_at,modified_at,generation,search_text,payload_bytes)
   SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM station_catalog_snapshots snapshot WHERE snapshot.device_id=? AND snapshot.generation=? AND snapshot.status='pending' AND snapshot.updated_at>? AND EXISTS(SELECT 1 FROM devices computer JOIN users owner ON owner.id=computer.owner_id WHERE computer.id=? AND computer.token_hash=? AND computer.revoked_at IS NULL AND owner.status='active'))
   AND (EXISTS(SELECT 1 FROM station_catalog_staging old WHERE old.device_id=? AND old.generation=? AND old.song_id=?)
    OR (SELECT COUNT(*) FROM station_catalog_staging staged WHERE staged.device_id=? AND staged.generation=?)
      < (SELECT expected_count FROM station_catalog_snapshots expected WHERE expected.device_id=? AND expected.generation=?))
   AND (SELECT COALESCE(SUM(payload_bytes),0) FROM station_catalog_staging staged WHERE staged.device_id=? AND staged.generation=?)
    - COALESCE((SELECT payload_bytes FROM station_catalog_staging old WHERE old.device_id=? AND old.generation=? AND old.song_id=?),0)+?<=8388608
   ON CONFLICT(device_id,generation,song_id) DO UPDATE SET title=excluded.title,content_hash=excluded.content_hash,filename=excluded.filename,category=excluded.category,language=excluded.language,font_size=excluded.font_size,text=excluded.text,first_slide=excluded.first_slide,added_at=excluded.added_at,modified_at=excluded.modified_at,search_text=excluded.search_text,payload_bytes=excluded.payload_bytes;
