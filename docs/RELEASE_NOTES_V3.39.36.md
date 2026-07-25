# V3.39.36

- Uma duplicidade de identidade passa a bloquear somente o lead conflitante.
- Os demais leads do mesmo lote continuam sendo persistidos normalmente.
- O lead bloqueado fica recusado apenas na prévia da sessão, sem ser salvo em `leads`.
- Abrange conflitos `duplicate_identity` e violações de unicidade detectadas pelo banco.
- Mantém intactas as regras de ramo, nota, reviews, destinos e Base Permanente.
