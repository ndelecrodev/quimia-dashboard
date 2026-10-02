CREATE TABLE tarefa_responsavel (
  task_id        TEXT    NOT NULL,
  funcionario_id INTEGER NOT NULL,
  PRIMARY KEY (task_id, funcionario_id),
  CONSTRAINT fk_tarefa_responsavel_tarefa
    FOREIGN KEY (task_id) REFERENCES tarefas(task_id),
  CONSTRAINT fk_tarefa_responsavel_funcionario
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id)
);

ALTER TABLE tarefa_responsavel ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Funcionario logado ve todos os vinculos de responsavel"
  ON tarefa_responsavel FOR SELECT TO public
  USING (is_registered_employee());
