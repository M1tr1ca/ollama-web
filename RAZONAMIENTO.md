# Sistema de Razonamiento en Ollama Web

## ¿Qué es el razonamiento?

Algunos modelos de lenguaje avanzados tienen la capacidad de "pensar" antes de responder, mostrando su proceso de razonamiento interno. Esto es especialmente útil para:
- Problemas matemáticos complejos
- Análisis lógico
- Programación avanzada
- Resolución de problemas paso a paso

## Modelos compatibles con razonamiento

### Modelos que soportan razonamiento explícito:
- **DeepSeek-R1** (y variantes)
- **QwQ** (Qwen con razonamiento)
- Otros modelos que implementen el estándar de razonamiento

### Cómo usar modelos con razonamiento:

1. **Instala un modelo compatible**:
```bash
ollama pull deepseek-r1:7b
# o
ollama pull qwq:32b
```

2. **Usa el modelo desde la interfaz**:
   - Selecciona el modelo en el menú desplegable
   - Haz una pregunta compleja
   - Observa el bloque "⚛ Pensó durante X segundos"
   - Haz clic en el bloque para expandir y ver el razonamiento completo

## Formatos de razonamiento soportados

La aplicación detecta automáticamente el razonamiento en varios formatos:

### 1. Campo `thinking` en la respuesta del API
```json
{
  "thinking": "Primero debo analizar...",
  "message": { "content": "La respuesta es..." }
}
```

### 2. Campo `reasoning` o `thought`
```json
{
  "reasoning": "Paso 1: ...",
  "message": { "content": "..." }
}
```

### 3. Tags especiales en el contenido
```
<think>
Voy a resolver esto paso a paso:
1. Primero...
2. Luego...
</think>
La respuesta final es...
```

## Interfaz del bloque de razonamiento

El bloque de razonamiento aparece con:
- **Icono**: ⚛ (átomo azul)
- **Título**: "Pensó durante X segundos" (colapsado por defecto)
- **Contenido**: El razonamiento completo del modelo (se expande al hacer clic)
- **Animación**: Puntos animados mientras el modelo está pensando

## Para desarrolladores

Si estás usando un modelo personalizado y quieres que muestre su razonamiento:

1. **Opción 1**: Incluye el razonamiento en un campo separado de la respuesta streaming
2. **Opción 2**: Envuelve el razonamiento en tags `<think>...</think>` en el contenido
3. **Opción 3**: La app automáticamente registra el tiempo hasta la primera respuesta (si > 1 segundo)

## Notas

- Los modelos sin capacidad de razonamiento seguirán funcionando normalmente
- El razonamiento se guarda en `localStorage` junto con las conversaciones
- Puedes expandir/colapsar el bloque de razonamiento haciendo clic en él

