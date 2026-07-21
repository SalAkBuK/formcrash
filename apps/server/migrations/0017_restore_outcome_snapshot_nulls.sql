DROP TRIGGER external_experiment_versions_prevent_update;

UPDATE external_experiment_versions
   SET outcome_checks_snapshot_json = COALESCE((
         SELECT json_group_array(json(normalized_check))
           FROM (
             SELECT CASE
                      WHEN json_type(
                             saved_check.value,
                             '$.target.fingerprint'
                           ) = 'object'
                      THEN json_set(
                             saved_check.value,
                             '$.target.fingerprint.dataFormcrash',
                             json_extract(
                               saved_check.value,
                               '$.target.fingerprint.dataFormcrash'
                             ),
                             '$.target.fingerprint.dataTestId',
                             json_extract(
                               saved_check.value,
                               '$.target.fingerprint.dataTestId'
                             ),
                             '$.target.fingerprint.id',
                             json_extract(
                               saved_check.value,
                               '$.target.fingerprint.id'
                             ),
                             '$.target.fingerprint.role',
                             json_extract(
                               saved_check.value,
                               '$.target.fingerprint.role'
                             ),
                             '$.target.fingerprint.accessibleName',
                             json_extract(
                               saved_check.value,
                               '$.target.fingerprint.accessibleName'
                             ),
                             '$.target.fingerprint.name',
                             json_extract(
                               saved_check.value,
                               '$.target.fingerprint.name'
                             )
                           )
                      ELSE saved_check.value
                    END AS normalized_check
               FROM json_each(
                      external_experiment_versions.outcome_checks_snapshot_json
                    ) AS saved_check
              ORDER BY CAST(saved_check.key AS INTEGER)
           )
       ), '[]');

CREATE TRIGGER external_experiment_versions_prevent_update
BEFORE UPDATE ON external_experiment_versions
BEGIN
  SELECT RAISE(ABORT, 'external experiment versions are immutable');
END;
