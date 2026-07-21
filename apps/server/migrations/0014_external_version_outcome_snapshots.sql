DROP TRIGGER external_experiment_versions_prevent_update;

ALTER TABLE external_experiment_versions
  ADD COLUMN critical_action_snapshot_json TEXT;

ALTER TABLE external_experiment_versions
  ADD COLUMN outcome_checks_snapshot_json TEXT NOT NULL DEFAULT '[]';

UPDATE external_experiment_versions
   SET critical_action_snapshot_json = (
         SELECT CASE
           WHEN ca.id IS NULL THEN NULL
           ELSE json_object(
             'id', ca.id,
             'journeyId', ca.journey_id,
             'stepId', ca.step_id,
             'label', ca.label,
             'createdAt', ca.created_at,
             'updatedAt', ca.updated_at
           )
         END
           FROM external_experiments e
           LEFT JOIN critical_actions ca ON ca.journey_id = e.journey_id
          WHERE e.id = external_experiment_versions.experiment_id
       ),
       outcome_checks_snapshot_json = COALESCE((
         SELECT json_group_array(json(check_json))
           FROM (
             SELECT json_patch(
                      json_object(
                        'id', oc.id,
                        'journeyId', oc.journey_id,
                        'criticalActionId', oc.critical_action_id,
                        'type', oc.outcome_type,
                        'createdAt', oc.created_at
                      ),
                      json(oc.definition_json)
                    ) AS check_json
               FROM outcome_checks oc
               JOIN external_experiments e
                 ON e.journey_id = oc.journey_id
              WHERE e.id = external_experiment_versions.experiment_id
              ORDER BY oc.created_at, oc.id
           )
       ), '[]');

CREATE TRIGGER external_experiment_versions_prevent_update
BEFORE UPDATE ON external_experiment_versions
BEGIN
  SELECT RAISE(ABORT, 'external experiment versions are immutable');
END;
