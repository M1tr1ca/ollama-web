// ========================================
// MODULO DE SALUD - Coach de Bienestar v3.0
// ExerciseDB API integrada
// Flujo: Sugerencias -> Seleccion -> Receta detallada
// ========================================

const healthState = {
  currentConversationId: null,
  userProfile: null,
  history: []
};

// ========================================
// ICONOS SVG (sin emojis)
// ========================================

const HEALTH_ICONS = {
  recipe: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 11h.01"/><path d="M11 15h.01"/><path d="M16 16h.01"/><path d="m2 16 20 6-6-20A20 20 0 0 0 2 16"/></svg>',
  clock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  fire: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>',
  users: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  circle: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>',
  star: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  tip: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>',
  list: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
  steps: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>',
  nutrition: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
  play: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
  video: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><path d="m10 8 6 4-6 4V8z"/></svg>',
  difficulty: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20h.01"/><path d="M7 20v-4"/><path d="M12 20v-8"/><path d="M17 20V8"/></svg>',
  muscle: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6.5 6.5c1.5-1.5 3.5-2 5-1s2 3.5.5 5l-7 7-3-3 7-7c1-1 .5-2.5-.5-3s-2.5 0-3.5 1.5"/><path d="M14 14l3.5 3.5"/><path d="M17.5 6.5l-3 3"/></svg>',
  heart: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
  calendar: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  warning: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  wind: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/></svg>',
  dumbbell: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 6.5h11"/><path d="M6.5 17.5h11"/><path d="M6 3h1v18H6z"/><path d="M17 3h1v18h-1z"/><path d="M3 7h3v10H3z"/><path d="M18 7h3v10h-3z"/><path d="M12 3v18"/></svg>',
  target: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
  bodyPart: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="3"/><path d="M12 8v4"/><path d="M8 12l-2 8"/><path d="M16 12l2 8"/><path d="M8 12h8"/><path d="M10 16l-1 4"/><path d="M14 16l1 4"/></svg>',
  equipment: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="4" height="10" rx="1"/><rect x="18" y="7" width="4" height="10" rx="1"/><path d="M6 12h12"/><path d="M6 9h12"/><path d="M6 15h12"/></svg>',
  search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>',
  refresh: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
  chevronDown: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
  info: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  zap: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>'
};

// ========================================
// SYSTEM PROMPT
// ========================================

function getHealthSystemPrompt() {
  const profile = getHealthProfile();
  let profileContext = '';

  if (profile && Object.keys(profile).length > 0) {
    profileContext = '\n\nPERFIL DE SALUD DEL USUARIO:';
    if (profile.age) profileContext += '\n- Edad: ' + profile.age + ' a\u00f1os';
    if (profile.weight) profileContext += '\n- Peso: ' + profile.weight + ' kg';
    if (profile.height) profileContext += '\n- Altura: ' + profile.height + ' cm';
    if (profile.gender) profileContext += '\n- G\u00e9nero: ' + profile.gender;
    if (profile.goal) profileContext += '\n- Objetivo: ' + profile.goal;
    if (profile.restrictions) profileContext += '\n- Restricciones alimentarias: ' + profile.restrictions;
    if (profile.conditions) profileContext += '\n- Condiciones m\u00e9dicas: ' + profile.conditions;
    if (profile.activityLevel) profileContext += '\n- Nivel de actividad: ' + profile.activityLevel;
  }

  return 'MODO SALUD Y BIENESTAR ACTIVADO.\n\nAVISO: Eres un asistente de IA para bienestar general. NO eres m\u00e9dico. Tus recomendaciones NO sustituyen consejo m\u00e9dico profesional.\n\nEres un coach de bienestar. Eres profesional, claro y directo. NO uses emojis. Responde siempre en espa\u00f1ol.' + profileContext + '\n\nFLUJO PARA RUNNING/CARDIO - MUY IMPORTANTE:\nCuando el usuario pida rutina de running, correr, cardio o similar:\n1. PRIMERO haz estas preguntas (una por una, espera respuesta):\n   - \u00bfCu\u00e1l es tu nivel actual? (Principiante/Intermedio/Avanzado)\n   - \u00bfCu\u00e1ntos d\u00edas a la semana puedes entrenar? (3-6 d\u00edas)\n   - \u00bfCu\u00e1l es tu objetivo? (Resistencia/Velocidad/Perder peso/Preparar carrera)\n   - \u00bfTienes alguna lesi\u00f3n o limitaci\u00f3n?\n\n2. LUEGO crea un plan semanal personalizado usando:\n\n[HEALTH_RUNNING_PLAN]\n[RUNNING_NAME:Plan de Running - [Nivel] - [Objetivo]]\n[RUNNING_LEVEL:Principiante/Intermedio/Avanzado]\n[RUNNING_GOAL:Objetivo del usuario]\n[RUNNING_WEEKS:4-12 semanas]\n[RUNNING_DAY:Lunes|Tipo de entrenamiento|Distancia/Duraci\u00f3n|Ritmo/Intensidad|Notas]\n[RUNNING_DAY:Martes|Descanso activo o Cross-training|Detalles|---|Opcional]\n[RUNNING_DAY:Mi\u00e9rcoles|...]\n[RUNNING_TIP:Consejo importante]\n[RUNNING_NUTRITION:Recomendaciones nutricionales]\n[RUNNING_WARNING:Advertencias si aplica]\n[/HEALTH_RUNNING_PLAN]\n\nTIPOS DE ENTRENAMIENTO RUNNING:\n- Rodaje suave/Recovery run: ritmo conversacional, construir base\n- Tempo run: ritmo sostenido inc\u00f3modo pero controlable\n- Intervalos: series r\u00e1pidas con descanso (ej: 6x800m)\n- Fartlek: cambios de ritmo aleatorios\n- Long run: carrera larga, ritmo c\u00f3modo\n- Hill training: cuestas para fuerza\n- Descanso activo: caminar, yoga, estiramientos\n\nFLUJO DE RECETAS:\nPASO 1 - SUGERENCIAS: Cuando el usuario pida recetas, primero ofrece 3-4 opciones:\n\n[HEALTH_SUGGESTIONS]\n[SUGGESTION:Nombre del plato 1|Descripci\u00f3n breve|Calor\u00edas|Tiempo]\n[SUGGESTION:Nombre del plato 2|Descripci\u00f3n breve|Calor\u00edas|Tiempo]\n[/HEALTH_SUGGESTIONS]\n\nPASO 2 - RECETA COMPLETA:\n[HEALTH_RECIPE]\n[RECIPE_NAME:Nombre]\n[RECIPE_TIME:Prep|Cocci\u00f3n]\n[RECIPE_SERVINGS:N\u00famero]\n[RECIPE_DIFFICULTY:F\u00e1cil/Media/Dif\u00edcil]\n[RECIPE_CALORIES:N\u00famero kcal]\n[RECIPE_INGREDIENT:cantidad|ingrediente|calor\u00edas]\n[RECIPE_STEP:1|Descripci\u00f3n]\n[RECIPE_NUTRITION:Xg Prote\u00ednas|Xg Carbohidratos|Xg Grasas|Xg Fibra]\n[RECIPE_TIP:Consejo]\n[/HEALTH_RECIPE]\n\nFORMATO RUTINAS GYM/FUERZA:\n[HEALTH_ROUTINE]\n[ROUTINE_NAME:Nombre]\n[ROUTINE_LEVEL:Principiante/Intermedio/Avanzado]\n[ROUTINE_DURATION:Duraci\u00f3n]\n[ROUTINE_EQUIPMENT:Equipamiento]\n[ROUTINE_MUSCLES:Grupos musculares]\n[ROUTINE_WARMUP:Calentamiento]\n[ROUTINE_EXERCISE:Nombre en INGLES|Series|Reps|Descanso|T\u00e9cnica|M\u00fasculos]\n[ROUTINE_COOLDOWN:Enfriamiento]\n[ROUTINE_TIP:Consejo]\n[/HEALTH_ROUTINE]\n\nEXPLORADOR DE EJERCICIOS:\nCuando pidan explorar ejercicios: [HEALTH_EXERCISE_EXPLORER]\n\nPLAN SEMANAL NUTRICI\u00d3N:\n[HEALTH_PLAN]\n[PLAN_NAME:Nombre]\n[PLAN_GOAL:Objetivo]\n[PLAN_DAY:D\u00eda|Desayuno|Comida|Cena|Ejercicio]\n[PLAN_TIP:Consejo]\n[/HEALTH_PLAN]\n\nBIENESTAR:\n[HEALTH_WELLNESS]\n[WELLNESS_NAME:Nombre]\n[WELLNESS_TYPE:Tipo]\n[WELLNESS_DURATION:Duraci\u00f3n]\n[WELLNESS_STEP:1|Instrucci\u00f3n]\n[WELLNESS_BENEFIT:Beneficio]\n[/HEALTH_WELLNESS]\n\nREGLAS ESTRICTAS:\n- NO uses emojis NUNCA\n- NO diagnostiques ni des dosis de medicamentos\n- NO menciones estos formatos al usuario\n- S\u00e9 profesional, claro y motivador\n- Para RUNNING: SIEMPRE pregunta primero (nivel, d\u00edas, objetivo, limitaciones)\n- Para RECETAS: SIEMPRE empieza con sugerencias\n- En ROUTINE_EXERCISE: nombres en ingl\u00e9s (Squat, Push Up, Deadlift, etc)\n- Planes running detallados d\u00eda a d\u00eda con distancias/tiempos espec\u00edficos';
}

// ========================================
// PERFIL DE SALUD
// ========================================

const HEALTH_PROFILE_KEY = 'ollama-web-health-profile';

function getHealthProfile() {
  try {
    const stored = localStorage.getItem(HEALTH_PROFILE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (e) { return {}; }
}

function saveHealthProfile(profile) {
  try {
    localStorage.setItem(HEALTH_PROFILE_KEY, JSON.stringify(profile));
  } catch (e) { console.warn('No se pudo guardar perfil de salud', e); }
}

// ========================================
// PARSING
// ========================================

function parseHealthCommands(content) {
  const data = {
    suggestions: [],
    recipes: [],
    routines: [],
    plans: [],
    wellness: [],
    runningPlans: [],
    exerciseExplorer: /\[HEALTH_EXERCISE_EXPLORER\]/.test(content)
  };

  // Parse sugerencias
  let sugBlocks = content.match(/\[HEALTH_SUGGESTIONS\]([\s\S]*?)\[\/HEALTH_SUGGESTIONS\]/g);
  if (!sugBlocks && /\[SUGGESTION:/.test(content)) {
    sugBlocks = [content];
  }
  if (sugBlocks) {
    sugBlocks.forEach(function(block) {
      const matches = block.match(/\[SUGGESTION:([^\]]+)\]/g);
      if (matches) {
        matches.forEach(function(m) {
          const val = m.match(/\[SUGGESTION:([^\]]+)\]/)[1];
          const parts = val.split('|');
          data.suggestions.push({
            name: (parts[0] || '').trim(),
            description: (parts[1] || '').trim(),
            calories: (parts[2] || '').trim(),
            time: (parts[3] || '').trim()
          });
        });
      }
    });
  }

  // Parse recetas
  let recipeBlocks = content.match(/\[HEALTH_RECIPE\]([\s\S]*?)\[\/HEALTH_RECIPE\]/g);
  if (!recipeBlocks && /\[RECIPE_NAME:/.test(content)) {
    recipeBlocks = [content];
  }
  if (recipeBlocks) {
    recipeBlocks.forEach(function(block) {
      var recipe = {};
      recipe.name = extractTag(block, 'RECIPE_NAME');
      var times = extractTag(block, 'RECIPE_TIME');
      if (times) {
        var tp = times.split('|');
        recipe.prepTime = (tp[0] || '').trim();
        recipe.cookTime = (tp[1] || '').trim();
      }
      recipe.servings = extractTag(block, 'RECIPE_SERVINGS');
      recipe.difficulty = extractTag(block, 'RECIPE_DIFFICULTY');
      recipe.calories = extractTag(block, 'RECIPE_CALORIES');
      recipe.tip = extractTag(block, 'RECIPE_TIP');

      // Ingredientes con calorias
      recipe.ingredients = [];
      var ingredientMatches = block.match(/\[RECIPE_INGREDIENT:([^\]]+)\]/g);
      if (ingredientMatches) {
        ingredientMatches.forEach(function(m) {
          var val = m.match(/\[RECIPE_INGREDIENT:([^\]]+)\]/)[1];
          var parts = val.split('|');
          if (parts.length >= 2) {
            recipe.ingredients.push({
              amount: (parts[0] || '').trim(),
              name: (parts[1] || '').trim(),
              calories: (parts[2] || '').trim()
            });
          } else {
            recipe.ingredients.push({ amount: '', name: val.trim(), calories: '' });
          }
        });
      }

      // Pasos - formato B: [RECIPE_STEP:N]text y formato A: [RECIPE_STEP:N|text]
      recipe.steps = [];
      var stepRegexB = /\[RECIPE_STEP:(\d+)\]([^\[]+)/g;
      var stepMatchB;
      while ((stepMatchB = stepRegexB.exec(block)) !== null) {
        var desc = stepMatchB[2].trim().replace(/\]+\s*$/g, '').replace(/:\]/g, ':').replace(/^\]/g, '').replace(/^\]+\s*/g, '').trim();
        if (desc && desc.length > 1) {
          recipe.steps.push({ number: stepMatchB[1].trim(), description: desc });
        }
      }
      if (recipe.steps.length === 0) {
        var stepMatchesA = block.match(/\[RECIPE_STEP:([^\]]+)\]/g);
        if (stepMatchesA) {
          stepMatchesA.forEach(function(m) {
            var val = m.match(/\[RECIPE_STEP:([^\]]+)\]/)[1];
            var parts = val.split('|');
            if (parts.length >= 2) {
              recipe.steps.push({ number: (parts[0] || '').trim(), description: parts.slice(1).join('|').trim() });
            } else {
              recipe.steps.push({ number: String(recipe.steps.length + 1), description: val.trim() });
            }
          });
        }
      }

      // Nutricion
      var nutrition = extractTag(block, 'RECIPE_NUTRITION');
      if (nutrition) {
        var nParts = nutrition.split('|').map(function(p) { return p.trim(); });
        recipe.nutrition = { protein: null, carbs: null, fat: null, fiber: null };
        var keywords = { protein: /prote[i\u00ed]n/i, carbs: /carbohidrato|hidrato|carbs/i, fat: /grasa|l[i\u00ed]pido|fat/i, fiber: /fibra|fiber/i };
        var found = false;
        for (var i = 0; i < nParts.length; i++) {
          var entries = Object.entries(keywords);
          for (var j = 0; j < entries.length; j++) {
            var key = entries[j][0];
            var regex = entries[j][1];
            if (regex.test(nParts[i])) {
              recipe.nutrition[key] = nParts[i];
              found = true;
            }
          }
        }
        if (!found) {
          recipe.nutrition.protein = nParts[0] || null;
          recipe.nutrition.carbs = nParts[1] || null;
          recipe.nutrition.fat = nParts[2] || null;
          recipe.nutrition.fiber = nParts[3] || null;
        }
      }

      if (recipe.name) data.recipes.push(recipe);
    });
  }

  // Parse rutinas
  var routineBlocks = content.match(/\[HEALTH_ROUTINE\]([\s\S]*?)\[\/HEALTH_ROUTINE\]/g);
  if (!routineBlocks && /\[ROUTINE_NAME:/.test(content)) routineBlocks = [content];
  if (routineBlocks) {
    routineBlocks.forEach(function(block) {
      var r = {};
      r.name = extractTag(block, 'ROUTINE_NAME');
      r.level = extractTag(block, 'ROUTINE_LEVEL');
      r.duration = extractTag(block, 'ROUTINE_DURATION');
      r.equipment = extractTag(block, 'ROUTINE_EQUIPMENT');
      r.muscles = extractTag(block, 'ROUTINE_MUSCLES');
      r.warmup = extractTag(block, 'ROUTINE_WARMUP');
      r.cooldown = extractTag(block, 'ROUTINE_COOLDOWN');
      r.warning = extractTag(block, 'ROUTINE_WARNING');
      r.tip = extractTag(block, 'ROUTINE_TIP');
      r.exercises = [];
      var exMatches = block.match(/\[ROUTINE_EXERCISE:([^\]]+)\]/g);
      if (exMatches) {
        exMatches.forEach(function(m) {
          var val = m.match(/\[ROUTINE_EXERCISE:([^\]]+)\]/)[1];
          var p = val.split('|');
          r.exercises.push({ name: (p[0]||'').trim(), sets: (p[1]||'').trim(), reps: (p[2]||'').trim(), rest: (p[3]||'').trim(), description: (p[4]||'').trim(), muscles: (p[5]||'').trim() });
        });
      }
      if (r.name) data.routines.push(r);
    });
  }

  // Parse planes
  var planBlocks = content.match(/\[HEALTH_PLAN\]([\s\S]*?)\[\/HEALTH_PLAN\]/g);
  if (!planBlocks && /\[PLAN_NAME:/.test(content)) planBlocks = [content];
  if (planBlocks) {
    planBlocks.forEach(function(block) {
      var p = {};
      p.name = extractTag(block, 'PLAN_NAME');
      p.goal = extractTag(block, 'PLAN_GOAL');
      p.tip = extractTag(block, 'PLAN_TIP');
      p.days = [];
      var dayMatches = block.match(/\[PLAN_DAY:([^\]]+)\]/g);
      if (dayMatches) {
        dayMatches.forEach(function(m) {
          var val = m.match(/\[PLAN_DAY:([^\]]+)\]/)[1];
          var parts = val.split('|');
          p.days.push({ day: (parts[0]||'').trim(), meals: parts.slice(1).map(function(x) { return x.trim(); }) });
        });
      }
      if (p.name) data.plans.push(p);
    });
  }

  // Parse wellness
  var wellnessBlocks = content.match(/\[HEALTH_WELLNESS\]([\s\S]*?)\[\/HEALTH_WELLNESS\]/g);
  if (!wellnessBlocks && /\[WELLNESS_NAME:/.test(content)) wellnessBlocks = [content];
  if (wellnessBlocks) {
    wellnessBlocks.forEach(function(block) {
      var w = {};
      w.name = extractTag(block, 'WELLNESS_NAME');
      w.type = extractTag(block, 'WELLNESS_TYPE');
      w.duration = extractTag(block, 'WELLNESS_DURATION');
      w.benefit = extractTag(block, 'WELLNESS_BENEFIT');
      w.steps = [];
      var sMatches = block.match(/\[WELLNESS_STEP:([^\]]+)\]/g);
      if (sMatches) {
        sMatches.forEach(function(m) {
          var val = m.match(/\[WELLNESS_STEP:([^\]]+)\]/)[1];
          var p = val.split('|');
          w.steps.push({ number: (p[0]||'').trim(), description: (p[1]||p[0]||'').trim() });
        });
      }
      if (w.name) data.wellness.push(w);
    });
  }

  // Parse running plans
  var runningBlocks = content.match(/\[HEALTH_RUNNING_PLAN\]([\s\S]*?)\[\/HEALTH_RUNNING_PLAN\]/g);
  if (!runningBlocks && /\[RUNNING_NAME:/.test(content)) runningBlocks = [content];
  if (runningBlocks) {
    runningBlocks.forEach(function(block) {
      var r = {};
      r.name = extractTag(block, 'RUNNING_NAME');
      r.level = extractTag(block, 'RUNNING_LEVEL');
      r.goal = extractTag(block, 'RUNNING_GOAL');
      r.weeks = extractTag(block, 'RUNNING_WEEKS');
      r.tip = extractTag(block, 'RUNNING_TIP');
      r.nutrition = extractTag(block, 'RUNNING_NUTRITION');
      r.warning = extractTag(block, 'RUNNING_WARNING');
      r.days = [];
      var dayMatches = block.match(/\[RUNNING_DAY:([^\]]+)\]/g);
      if (dayMatches) {
        dayMatches.forEach(function(m) {
          var val = m.match(/\[RUNNING_DAY:([^\]]+)\]/)[1];
          var parts = val.split('|');
          r.days.push({
            day: (parts[0]||'').trim(),
            type: (parts[1]||'').trim(),
            distance: (parts[2]||'').trim(),
            pace: (parts[3]||'').trim(),
            notes: (parts[4]||'').trim()
          });
        });
      }
      if (r.name) data.runningPlans.push(r);
    });
  }

  return data;
}

function extractTag(block, tagName) {
  var regex = new RegExp('\\[' + tagName + ':([^\\]]+)\\]');
  var match = block.match(regex);
  if (match) return match[1].trim();
  var regexNB = new RegExp('(?:^|\\n)\\s*' + tagName + ':(.+)', 'm');
  var matchNB = block.match(regexNB);
  return matchNB ? matchNB[1].trim() : null;
}

function hasHealthContent(content) {
  return /\[HEALTH_(?:RECIPE|ROUTINE|PLAN|WELLNESS|SUGGESTIONS|EXERCISE_EXPLORER|RUNNING_PLAN)\]|\[(?:RECIPE_NAME|ROUTINE_NAME|PLAN_NAME|WELLNESS_NAME|RUNNING_NAME|SUGGESTION):/.test(content);
}

// ========================================
// CACHE DE IMAGENES
// ========================================

var IMAGE_CACHE_KEY = 'ollama-health-image-cache';
var CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 horas

function getCachedImages(query) {
  try {
    var cache = localStorage.getItem(IMAGE_CACHE_KEY);
    if (!cache) return null;
    var cacheData = JSON.parse(cache);
    var entry = cacheData[query];
    if (!entry) return null;
    // Verificar expiración
    if (Date.now() - entry.timestamp > CACHE_EXPIRY_MS) {
      delete cacheData[query];
      localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(cacheData));
      return null;
    }
    return entry.images;
  } catch (e) { return null; }
}

function setCachedImages(query, images) {
  try {
    var cache = localStorage.getItem(IMAGE_CACHE_KEY);
    var cacheData = cache ? JSON.parse(cache) : {};
    cacheData[query] = {
      images: images,
      timestamp: Date.now()
    };
    // Limpiar entradas antiguas (más de 7 días)
    var weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    for (var key in cacheData) {
      if (cacheData[key].timestamp < weekAgo) {
        delete cacheData[key];
      }
    }
    localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(cacheData));
  } catch (e) { console.warn('No se pudo guardar caché de imágenes', e); }
}

function getCachedVideo(query) {
  try {
    var cache = localStorage.getItem(IMAGE_CACHE_KEY);
    if (!cache) return null;
    var cacheData = JSON.parse(cache);
    var videoKey = 'video:' + query;
    var entry = cacheData[videoKey];
    if (!entry) return null;
    if (Date.now() - entry.timestamp > CACHE_EXPIRY_MS) {
      delete cacheData[videoKey];
      localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(cacheData));
      return null;
    }
    return entry.video;
  } catch (e) { return null; }
}

function setCachedVideo(query, video) {
  try {
    var cache = localStorage.getItem(IMAGE_CACHE_KEY);
    var cacheData = cache ? JSON.parse(cache) : {};
    var videoKey = 'video:' + query;
    cacheData[videoKey] = {
      video: video,
      timestamp: Date.now()
    };
    localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(cacheData));
  } catch (e) { console.warn('No se pudo guardar caché de video', e); }
}

// ========================================
// SERPER API - Imagenes y Videos
// ========================================

function searchSerperImages(query, num) {
  if (!num) num = 4;
  
  // Intentar obtener del caché primero
  var cached = getCachedImages(query);
  if (cached && cached.length > 0) {
    return Promise.resolve(cached.slice(0, num));
  }
  
  var key = localStorage.getItem('serper-api-key');
  if (!key) return Promise.resolve([]);
  return fetch('https://google.serper.dev/images', {
    method: 'POST',
    headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, gl: 'es', hl: 'es', num: num })
  }).then(function(res) {
    if (!res.ok) return [];
    return res.json();
  }).then(function(data) {
    var images = (data.images || []).filter(function(img) { return img.imageUrl; }).map(function(img) { return img.imageUrl; });
    // Guardar en caché
    if (images.length > 0) {
      setCachedImages(query, images);
    }
    return images;
  }).catch(function() { return []; });
}

function searchYouTubeVideo(query) {
  // Intentar obtener del caché primero
  var cached = getCachedVideo(query);
  if (cached) {
    return Promise.resolve(cached);
  }
  
  var key = localStorage.getItem('serper-api-key');
  if (!key) return Promise.resolve(null);
  return fetch('https://google.serper.dev/videos', {
    method: 'POST',
    headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query + ' recipe', gl: 'us', hl: 'en', num: 3 })
  }).then(function(res) {
    if (!res.ok) return null;
    return res.json();
  }).then(function(data) {
    var videos = data.videos || [];
    var ytVideo = videos.find(function(v) { return v.link && v.link.indexOf('youtube.com/watch') !== -1; });
    var result = null;
    if (ytVideo) {
      var match = ytVideo.link.match(/[?&]v=([^&]+)/);
      if (match) {
        result = { id: match[1], title: ytVideo.title, link: ytVideo.link };
      }
    }
    // Guardar en caché (incluso si es null, para evitar requests repetidos)
    setCachedVideo(query, result);
    return result;
  }).catch(function() { return null; });
}

// ========================================
// EXERCISEDB API
// ========================================

var EXERCISEDB_BASE = 'https://exercisedb-api.vercel.app/api/v1';
var EXERCISEDB_CACHE_KEY = 'ollama-exercisedb-cache';
var EXERCISEDB_CACHE_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 dias

var BODY_PARTS_MAP = {
  'back': { label: 'Espalda', icon: 'bodyPart' },
  'cardio': { label: 'Cardio', icon: 'heart' },
  'chest': { label: 'Pecho', icon: 'bodyPart' },
  'lower arms': { label: 'Antebrazos', icon: 'muscle' },
  'lower legs': { label: 'Piernas (inf)', icon: 'bodyPart' },
  'neck': { label: 'Cuello', icon: 'bodyPart' },
  'shoulders': { label: 'Hombros', icon: 'bodyPart' },
  'upper arms': { label: 'Brazos (sup)', icon: 'muscle' },
  'upper legs': { label: 'Piernas (sup)', icon: 'bodyPart' },
  'waist': { label: 'Abdomen', icon: 'bodyPart' }
};

function getExerciseDBCache(key) {
  try {
    var cache = localStorage.getItem(EXERCISEDB_CACHE_KEY);
    if (!cache) return null;
    var data = JSON.parse(cache);
    var entry = data[key];
    if (!entry) return null;
    if (Date.now() - entry.timestamp > EXERCISEDB_CACHE_EXPIRY) {
      delete data[key];
      localStorage.setItem(EXERCISEDB_CACHE_KEY, JSON.stringify(data));
      return null;
    }
    return entry.data;
  } catch (e) { return null; }
}

function setExerciseDBCache(key, value) {
  try {
    var cache = localStorage.getItem(EXERCISEDB_CACHE_KEY);
    var data = cache ? JSON.parse(cache) : {};
    data[key] = { data: value, timestamp: Date.now() };
    // Limpiar antiguas
    var cutoff = Date.now() - (14 * 24 * 60 * 60 * 1000);
    for (var k in data) { if (data[k].timestamp < cutoff) delete data[k]; }
    localStorage.setItem(EXERCISEDB_CACHE_KEY, JSON.stringify(data));
  } catch (e) { /* ignore */ }
}

function fetchExercisesByBodyPart(bodyPart, limit) {
  if (!limit) limit = 12;
  var cacheKey = 'bp:' + bodyPart + ':' + limit;
  var cached = getExerciseDBCache(cacheKey);
  if (cached) return Promise.resolve(cached);

  return fetch(EXERCISEDB_BASE + '/bodyparts/' + encodeURIComponent(bodyPart) + '/exercises?limit=' + limit + '&offset=' + Math.floor(Math.random() * 20))
    .then(function(res) { return res.ok ? res.json() : { data: [] }; })
    .then(function(json) {
      var exercises = json.data || [];
      if (exercises.length > 0) setExerciseDBCache(cacheKey, exercises);
      return exercises;
    })
    .catch(function() { return []; });
}

function fetchExercisesByName(name, limit) {
  if (!limit) limit = 6;
  var cacheKey = 'name:' + name.toLowerCase().trim();
  var cached = getExerciseDBCache(cacheKey);
  if (cached) return Promise.resolve(cached);

  return fetch(EXERCISEDB_BASE + '/exercises?search=' + encodeURIComponent(name) + '&limit=' + limit + '&offset=0')
    .then(function(res) { return res.ok ? res.json() : { data: [] }; })
    .then(function(json) {
      var exercises = json.data || [];
      if (exercises.length > 0) setExerciseDBCache(cacheKey, exercises);
      return exercises;
    })
    .catch(function() { return []; });
}

function searchExerciseForRoutine(exerciseName) {
  var simplified = exerciseName.toLowerCase()
    .replace(/con\s+/g, '')
    .replace(/de\s+/g, '')
    .replace(/el\s+/g, '')
    .replace(/la\s+/g, '')
    .replace(/los\s+/g, '')
    .replace(/las\s+/g, '');

  // Mapa de traducciones comunes
  var translations = {
    'sentadilla': 'squat', 'sentadillas': 'squat',
    'flexiones': 'push up', 'flexion': 'push up',
    'dominadas': 'pull up', 'dominada': 'pull up',
    'press banca': 'bench press', 'press de banca': 'bench press',
    'peso muerto': 'deadlift', 'curl biceps': 'bicep curl',
    'curl de biceps': 'bicep curl', 'curl': 'curl',
    'plancha': 'plank', 'planchas': 'plank',
    'zancadas': 'lunge', 'zancada': 'lunge',
    'fondos': 'dip', 'fondo': 'dip',
    'remo': 'row', 'press militar': 'overhead press',
    'press hombro': 'shoulder press', 'press de hombro': 'shoulder press',
    'abdominales': 'crunch', 'abdominal': 'crunch',
    'elevaciones laterales': 'lateral raise',
    'elevacion lateral': 'lateral raise',
    'triceps': 'tricep', 'extension triceps': 'tricep extension',
    'hip thrust': 'hip thrust', 'patada gluteo': 'glute kickback',
    'burpees': 'burpee', 'burpee': 'burpee',
    'mountain climbers': 'mountain climber',
    'jumping jacks': 'jumping jack',
    'caminata': 'walk', 'correr': 'run', 'trotar': 'jog',
    'estiramiento': 'stretch', 'estiramientos': 'stretch'
  };

  var searchTerm = exerciseName;
  for (var esp in translations) {
    if (simplified.indexOf(esp) !== -1) {
      searchTerm = translations[esp];
      break;
    }
  }

  return fetchExercisesByName(searchTerm, 3).then(function(exercises) {
    return exercises.length > 0 ? exercises[0] : null;
  });
}

// ========================================
// RENDER COMPONENTES
// ========================================

function renderHealthComponents(bubble, healthData) {
  if (!bubble || !healthData) return;

  if (healthData.suggestions.length > 0) {
    var el = renderSuggestionsGrid(healthData.suggestions);
    if (el) bubble.appendChild(el);
  }

  healthData.recipes.forEach(function(recipe) {
    var el = renderRecipeCard(recipe);
    if (el) bubble.appendChild(el);
  });

  healthData.routines.forEach(function(routine) {
    var el = renderRoutineCard(routine);
    if (el) {
      bubble.appendChild(el);
      // Enriquecer ejercicios con datos de ExerciseDB
      enrichRoutineWithExerciseDB(el, routine);
    }
  });

  healthData.plans.forEach(function(plan) {
    var el = renderPlanCard(plan);
    if (el) bubble.appendChild(el);
  });

  healthData.wellness.forEach(function(w) {
    var el = renderWellnessCard(w);
    if (el) bubble.appendChild(el);
  });

  healthData.runningPlans.forEach(function(rp) {
    var el = renderRunningPlanCard(rp);
    if (el) bubble.appendChild(el);
  });

  // Explorador de ejercicios
  if (healthData.exerciseExplorer) {
    var explorer = renderExerciseExplorer();
    if (explorer) bubble.appendChild(explorer);
  }
}

// ========================================
// TARJETAS DE SUGERENCIAS (clickables)
// ========================================

function renderSuggestionsGrid(suggestions) {
  var container = document.createElement('div');
  container.className = 'health-suggestions-grid';

  suggestions.forEach(function(sug) {
    var card = document.createElement('div');
    card.className = 'health-suggestion-card';
    card.innerHTML = '<div class="suggestion-image-wrap"><div class="suggestion-image-placeholder"><div class="suggestion-image-loader"></div></div></div><div class="suggestion-info"><div class="suggestion-name">' + escapeHTML(sug.name) + '</div><div class="suggestion-desc">' + escapeHTML(sug.description) + '</div><div class="suggestion-meta">' + (sug.calories ? '<span class="suggestion-meta-item">' + HEALTH_ICONS.fire + ' ' + escapeHTML(sug.calories) + '</span>' : '') + (sug.time ? '<span class="suggestion-meta-item">' + HEALTH_ICONS.clock + ' ' + escapeHTML(sug.time) + '</span>' : '') + '</div></div>';

    // Al clicar, enviar mensaje automaticamente
    (function(name) {
      card.addEventListener('click', function() {
        sendHealthMessage('Desarrolla la receta: ' + name);
      });
    })(sug.name);
    card.title = 'Clic para ver la receta de ' + sug.name;
    container.appendChild(card);

    // Buscar imagen async
    (function(cardRef, name) {
      searchSerperImages(name + ' receta plato', 1).then(function(images) {
        var wrap = cardRef.querySelector('.suggestion-image-wrap');
        if (images.length > 0 && wrap) {
          wrap.innerHTML = '<img class="suggestion-image" src="' + images[0] + '" alt="' + escapeHTML(name) + '" loading="lazy" onerror="this.parentElement.innerHTML=\'<div class=\\\'suggestion-image-placeholder\\\'>' + HEALTH_ICONS.recipe + '</div>\'">';
        } else if (wrap) {
          wrap.innerHTML = '<div class="suggestion-image-placeholder">' + HEALTH_ICONS.recipe + '</div>';
        }
      });
    })(card, sug.name);
  });

  return container;
}

function sendHealthMessage(text) {
  var emptyState = document.getElementById('empty-state');
  var isEmptyState = emptyState && emptyState.style.display !== 'none';
  var input = isEmptyState
    ? document.getElementById('prompt-input')
    : document.getElementById('prompt-input-inline');

  if (input) {
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    var form = input.closest('form');
    if (form) {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }
  }
}

// ========================================
// TARJETA DE RECETA (redise\u00f1ada)
// ========================================

function renderRecipeCard(recipe) {
  var card = document.createElement('div');
  card.className = 'health-recipe-card';

  var heroOverlay = '<div class="recipe-hero-overlay"><h3 class="recipe-hero-title">' + escapeHTML(recipe.name) + '</h3><div class="recipe-hero-badges">' + (recipe.difficulty ? '<span class="recipe-badge">' + HEALTH_ICONS.difficulty + ' ' + escapeHTML(recipe.difficulty) + '</span>' : '') + (recipe.calories ? '<span class="recipe-badge">' + HEALTH_ICONS.fire + ' ' + escapeHTML(recipe.calories) + (/kcal|cal/i.test(recipe.calories) ? '' : ' kcal') + '</span>' : '') + (recipe.servings ? '<span class="recipe-badge">' + HEALTH_ICONS.users + ' ' + escapeHTML(recipe.servings) + (/porcion|persona|raci/i.test(recipe.servings) ? '' : ' porciones') + '</span>' : '') + (recipe.prepTime ? '<span class="recipe-badge">' + HEALTH_ICONS.clock + ' ' + escapeHTML(recipe.prepTime) + '</span>' : '') + '</div></div>';

  var imageHTML = '<div class="recipe-hero"><div class="recipe-hero-loader"></div>' + heroOverlay + '</div>';

  var videoHTML = '<div class="recipe-video-section" style="display:none"><div class="recipe-video-container"></div></div>';

  // Ingredientes
  var ingredientsHTML = '';
  if (recipe.ingredients && recipe.ingredients.length > 0) {
    var ingItems = '';
    recipe.ingredients.forEach(function(ing) {
      ingItems += '<div class="recipe-ingredient-row"><span class="ingredient-check-icon">' + HEALTH_ICONS.circle + '</span><span class="ingredient-text">' + (ing.amount ? '<strong>' + escapeHTML(ing.amount) + '</strong> ' : '') + escapeHTML(ing.name) + '</span>' + (ing.calories ? '<span class="ingredient-cal">' + escapeHTML(ing.calories) + '</span>' : '') + '</div>';
    });
    ingredientsHTML = '<div class="recipe-ingredients-box"><div class="recipe-section-header">' + HEALTH_ICONS.list + ' <span>Ingredientes</span></div><div class="recipe-ingredients-list">' + ingItems + '</div></div>';
  }

  // Pasos
  var stepsHTML = '';
  if (recipe.steps && recipe.steps.length > 0) {
    var stepItems = '';
    recipe.steps.forEach(function(step) {
      stepItems += '<div class="recipe-step-bubble"><div class="step-number-badge">' + escapeHTML(step.number) + '</div><div class="step-content">' + parseSimpleMarkdown(step.description) + '</div></div>';
    });
    stepsHTML = '<div class="recipe-steps-section"><div class="recipe-section-header">' + HEALTH_ICONS.steps + ' <span>Preparación</span></div><div class="recipe-steps-flow">' + stepItems + '</div></div>';
  }

  // Nutricion
  var nutritionHTML = '';
  if (recipe.nutrition) {
    var nutItems = [
      { label: 'Prote\u00ednas', value: recipe.nutrition.protein, color: '#10b981' },
      { label: 'Carbohidratos', value: recipe.nutrition.carbs, color: '#f59e0b' },
      { label: 'Grasas', value: recipe.nutrition.fat, color: '#ef4444' },
      { label: 'Fibra', value: recipe.nutrition.fiber, color: '#8b5cf6' }
    ].filter(function(i) { return i.value; });
    if (nutItems.length > 0) {
      var nutChips = '';
      nutItems.forEach(function(i) {
        nutChips += '<div class="nutrition-chip" style="--nut-color: ' + i.color + '"><span class="nutrition-chip-value">' + escapeHTML(i.value) + '</span><span class="nutrition-chip-label">' + i.label + '</span></div>';
      });
      nutritionHTML = '<div class="recipe-nutrition-bar"><div class="recipe-section-header">' + HEALTH_ICONS.nutrition + ' <span>Nutrici\u00f3n por porci\u00f3n</span></div><div class="recipe-nutrition-items">' + nutChips + '</div></div>';
    }
  }

  // Tip
  var tipHTML = '';
  if (recipe.tip) {
    tipHTML = '<div class="recipe-tip-bar">' + HEALTH_ICONS.tip + ' <span>' + escapeHTML(recipe.tip) + '</span></div>';
  }

  card.innerHTML = imageHTML + videoHTML + ingredientsHTML + stepsHTML + nutritionHTML + tipHTML;

  // Ingredientes clickables
  card.querySelectorAll('.recipe-ingredient-row').forEach(function(row) {
    row.addEventListener('click', function() {
      row.classList.toggle('checked');
      var icon = row.querySelector('.ingredient-check-icon');
      if (icon) icon.innerHTML = row.classList.contains('checked') ? HEALTH_ICONS.check : HEALTH_ICONS.circle;
    });
  });

  // Cargar imagen real
  if (recipe.name) {
    searchSerperImages(recipe.name + ' plato receta comida', 1).then(function(images) {
      var hero = card.querySelector('.recipe-hero');
      if (images.length > 0 && hero) {
        hero.style.backgroundImage = 'url(' + images[0] + ')';
        hero.style.backgroundSize = 'cover';
        hero.style.backgroundPosition = 'center';
        hero.classList.add('has-image');
      }
      var loader = card.querySelector('.recipe-hero-loader');
      if (loader) loader.remove();
    });

    // Buscar video de YouTube
    searchYouTubeVideo(recipe.name).then(function(video) {
      if (video) {
        var videoSection = card.querySelector('.recipe-video-section');
        var videoContainer = card.querySelector('.recipe-video-container');
        if (videoSection && videoContainer) {
          videoSection.style.display = 'block';
          videoContainer.innerHTML = '<div class="recipe-video-header">' + HEALTH_ICONS.video + ' <span>Video tutorial</span></div><div class="recipe-video-embed"><iframe src="https://www.youtube.com/embed/' + video.id + '" title="' + escapeHTML(video.title || recipe.name) + '" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>';
        }
      }
    });
  }

  return card;
}

// ========================================
// TARJETA DE RUTINA
// ========================================

function renderRoutineCard(routine) {
  var card = document.createElement('div');
  card.className = 'health-routine-card';

  var levelMap = { 'principiante': 'beginner', 'intermedio': 'intermediate', 'avanzado': 'advanced' };
  var levelClass = levelMap[(routine.level || '').toLowerCase()] || 'beginner';

  var html = '<div class="routine-hero-banner"><div class="routine-hero-content"><div class="routine-hero-icon">' + HEALTH_ICONS.dumbbell + '</div><h3 class="routine-hero-title">' + escapeHTML(routine.name) + '</h3><div class="routine-hero-badges">' + (routine.level ? '<span class="health-badge ' + levelClass + '">' + escapeHTML(routine.level) + '</span>' : '') + (routine.duration ? '<span class="health-badge">' + HEALTH_ICONS.clock + ' ' + escapeHTML(routine.duration) + '</span>' : '') + (routine.equipment && routine.equipment !== 'Ninguno' ? '<span class="health-badge">' + HEALTH_ICONS.equipment + ' ' + escapeHTML(routine.equipment) + '</span>' : '') + (routine.muscles ? '<span class="health-badge">' + HEALTH_ICONS.target + ' ' + escapeHTML(routine.muscles) + '</span>' : '') + '</div></div></div>';

  if (routine.warmup) {
    html += '<div class="health-section warmup-section"><div class="recipe-section-header">' + HEALTH_ICONS.fire + ' <span>Calentamiento</span></div><p>' + escapeHTML(routine.warmup) + '</p></div>';
  }

  if (routine.exercises && routine.exercises.length > 0) {
    html += '<div class="health-section"><div class="recipe-section-header">' + HEALTH_ICONS.dumbbell + ' <span>Ejercicios</span></div><div class="exdb-exercises-grid">';
    routine.exercises.forEach(function(ex, i) {
      html += '<div class="exdb-exercise-card" data-index="' + i + '" data-exercise-name="' + escapeHTML(ex.name) + '"><div class="exdb-exercise-gif-wrap"><div class="exdb-gif-placeholder"><div class="exdb-gif-loader"></div></div></div><div class="exdb-exercise-body"><div class="exdb-exercise-number">' + (i + 1) + '</div><div class="exdb-exercise-title">' + escapeHTML(ex.name) + '</div><div class="exdb-exercise-tags">' + (ex.sets ? '<span class="exdb-tag">' + escapeHTML(ex.sets) + ' series</span>' : '') + (ex.reps ? '<span class="exdb-tag">' + escapeHTML(ex.reps) + '</span>' : '') + (ex.rest ? '<span class="exdb-tag-rest">' + HEALTH_ICONS.clock + ' ' + escapeHTML(ex.rest) + '</span>' : '') + '</div>' + (ex.muscles ? '<div class="exdb-exercise-muscles">' + HEALTH_ICONS.target + ' <span>' + escapeHTML(ex.muscles) + '</span></div>' : '') + '</div><div class="exdb-exercise-detail" style="display:none">' + (ex.description ? '<div class="exdb-detail-technique"><div class="exdb-detail-label">' + HEALTH_ICONS.info + ' Tecnica</div><p>' + escapeHTML(ex.description) + '</p></div>' : '') + '<div class="exdb-detail-api" data-exercise-name="' + escapeHTML(ex.name) + '"></div></div></div>';
    });
    html += '</div></div>';
  }

  if (routine.cooldown) {
    html += '<div class="health-section cooldown-section"><div class="recipe-section-header">' + HEALTH_ICONS.wind + ' <span>Enfriamiento</span></div><p>' + escapeHTML(routine.cooldown) + '</p></div>';
  }
  if (routine.warning) {
    html += '<div class="health-warning-box">' + HEALTH_ICONS.warning + ' <span>' + escapeHTML(routine.warning) + '</span></div>';
  }
  if (routine.tip) {
    html += '<div class="recipe-tip-bar">' + HEALTH_ICONS.tip + ' <span>' + escapeHTML(routine.tip) + '</span></div>';
  }

  card.innerHTML = html;

  // Click para expandir/contraer detalle
  card.querySelectorAll('.exdb-exercise-card').forEach(function(item) {
    item.addEventListener('click', function() {
      var detail = item.querySelector('.exdb-exercise-detail');
      var isOpen = item.classList.contains('expanded');
      // Cerrar todos los demás
      card.querySelectorAll('.exdb-exercise-card.expanded').forEach(function(other) {
        if (other !== item) {
          other.classList.remove('expanded');
          var od = other.querySelector('.exdb-exercise-detail');
          if (od) od.style.display = 'none';
        }
      });
      if (detail) {
        item.classList.toggle('expanded');
        detail.style.display = isOpen ? 'none' : 'block';
      }
    });
  });

  return card;
}

// ========================================
// ENRIQUECER RUTINA CON EXERCISEDB
// ========================================

function enrichRoutineWithExerciseDB(cardEl, routine) {
  if (!routine.exercises || routine.exercises.length === 0) return;

  routine.exercises.forEach(function(ex, i) {
    var exCard = cardEl.querySelectorAll('.exdb-exercise-card')[i];
    if (!exCard) return;

    searchExerciseForRoutine(ex.name).then(function(apiEx) {
      var gifWrap = exCard.querySelector('.exdb-exercise-gif-wrap');
      var detailApi = exCard.querySelector('.exdb-detail-api');

      if (apiEx && apiEx.gifUrl) {
        // Insertar GIF
        if (gifWrap) {
          var gifImg = document.createElement('img');
          gifImg.className = 'exdb-exercise-gif';
          gifImg.src = apiEx.gifUrl;
          gifImg.alt = apiEx.name || '';
          gifImg.loading = 'lazy';
          gifImg.onerror = function() {
            gifWrap.innerHTML = '<div class="exdb-gif-placeholder">' + HEALTH_ICONS.dumbbell + '</div>';
          };
          gifWrap.innerHTML = '';
          gifWrap.appendChild(gifImg);
        }
        // Insertar detalles de API
        if (detailApi && apiEx) {
          var apiHTML = '';
          if (apiEx.targetMuscles && apiEx.targetMuscles.length > 0) {
            apiHTML += '<div class="exdb-detail-section"><div class="exdb-detail-label">' + HEALTH_ICONS.target + ' Musculos principales</div><div class="exdb-detail-chips">' + apiEx.targetMuscles.map(function(m) { return '<span class="exdb-chip exdb-chip-primary">' + escapeHTML(m) + '</span>'; }).join('') + '</div></div>';
          }
          if (apiEx.secondaryMuscles && apiEx.secondaryMuscles.length > 0) {
            apiHTML += '<div class="exdb-detail-section"><div class="exdb-detail-label">' + HEALTH_ICONS.muscle + ' Musculos secundarios</div><div class="exdb-detail-chips">' + apiEx.secondaryMuscles.map(function(m) { return '<span class="exdb-chip exdb-chip-secondary">' + escapeHTML(m) + '</span>'; }).join('') + '</div></div>';
          }
          if (apiEx.equipments && apiEx.equipments.length > 0) {
            apiHTML += '<div class="exdb-detail-section"><div class="exdb-detail-label">' + HEALTH_ICONS.equipment + ' Equipamiento</div><div class="exdb-detail-chips">' + apiEx.equipments.map(function(e) { return '<span class="exdb-chip exdb-chip-equip">' + escapeHTML(e) + '</span>'; }).join('') + '</div></div>';
          }
          if (apiEx.instructions && apiEx.instructions.length > 0) {
            apiHTML += '<div class="exdb-detail-section"><div class="exdb-detail-label">' + HEALTH_ICONS.steps + ' Instrucciones</div><div class="exdb-detail-steps">' + apiEx.instructions.map(function(inst, idx) {
              var cleanInst = inst.replace(/^Step:\d+\s*/i, '');
              return '<div class="exdb-instruction-step"><span class="exdb-inst-num">' + (idx + 1) + '</span><span class="exdb-inst-text">' + escapeHTML(cleanInst) + '</span></div>';
            }).join('') + '</div></div>';
          }
          if (apiHTML) {
            apiHTML = '<div class="exdb-api-data"><div class="exdb-api-header">' + HEALTH_ICONS.zap + ' <span>Datos de ExerciseDB</span></div>' + apiHTML + '</div>';
            detailApi.innerHTML = apiHTML;
          }
        }
      } else {
        // Sin resultados de API
        if (gifWrap) {
          gifWrap.innerHTML = '<div class="exdb-gif-placeholder">' + HEALTH_ICONS.dumbbell + '</div>';
        }
      }
    });
  });
}

// ========================================
// EXPLORADOR DE EJERCICIOS (standalone)
// ========================================

function renderExerciseExplorer() {
  var container = document.createElement('div');
  container.className = 'exdb-explorer';

  var html = '<div class="exdb-explorer-header"><div class="exdb-explorer-title">' + HEALTH_ICONS.dumbbell + ' <span>Explorador de Ejercicios</span></div><p class="exdb-explorer-subtitle">Selecciona un grupo muscular para descubrir ejercicios con animaciones</p></div>';

  html += '<div class="exdb-bodyparts-grid">';
  var parts = Object.keys(BODY_PARTS_MAP);
  parts.forEach(function(bp) {
    var info = BODY_PARTS_MAP[bp];
    html += '<button class="exdb-bodypart-btn" data-bodypart="' + bp + '">' + HEALTH_ICONS[info.icon] + ' <span>' + info.label + '</span></button>';
  });
  html += '</div>';

  html += '<div class="exdb-explorer-results" style="display:none"><div class="exdb-results-header"><span class="exdb-results-title"></span><button class="exdb-refresh-btn">' + HEALTH_ICONS.refresh + '</button></div><div class="exdb-results-grid"></div></div>';

  container.innerHTML = html;

  // Eventos
  container.querySelectorAll('.exdb-bodypart-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      container.querySelectorAll('.exdb-bodypart-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      loadExercisesForBodyPart(container, btn.getAttribute('data-bodypart'));
    });
  });

  var refreshBtn = container.querySelector('.exdb-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', function() {
      var activeBtn = container.querySelector('.exdb-bodypart-btn.active');
      if (activeBtn) {
        var bp = activeBtn.getAttribute('data-bodypart');
        // Limpiar cache para forzar nuevos resultados
        try {
          var cache = localStorage.getItem(EXERCISEDB_CACHE_KEY);
          if (cache) {
            var data = JSON.parse(cache);
            for (var k in data) { if (k.indexOf('bp:' + bp) === 0) delete data[k]; }
            localStorage.setItem(EXERCISEDB_CACHE_KEY, JSON.stringify(data));
          }
        } catch (e) { /* ignore */ }
        loadExercisesForBodyPart(container, bp);
      }
    });
  }

  return container;
}

function loadExercisesForBodyPart(container, bodyPart) {
  var resultsSection = container.querySelector('.exdb-explorer-results');
  var resultsGrid = container.querySelector('.exdb-results-grid');
  var resultsTitle = container.querySelector('.exdb-results-title');
  var info = BODY_PARTS_MAP[bodyPart] || { label: bodyPart };

  resultsSection.style.display = 'block';
  resultsTitle.textContent = info.label;
  resultsGrid.innerHTML = '<div class="exdb-loading"><div class="exdb-loading-spinner"></div><span>Buscando ejercicios...</span></div>';

  fetchExercisesByBodyPart(bodyPart, 12).then(function(exercises) {
    if (exercises.length === 0) {
      resultsGrid.innerHTML = '<div class="exdb-no-results">' + HEALTH_ICONS.search + ' <span>No se encontraron ejercicios. Intenta de nuevo.</span></div>';
      return;
    }

    var gridHTML = '';
    exercises.forEach(function(ex) {
      var musclesHTML = '';
      if (ex.targetMuscles && ex.targetMuscles.length > 0) {
        musclesHTML = '<div class="exdb-explore-muscles">' + HEALTH_ICONS.target + ' ' + ex.targetMuscles.map(function(m) { return '<span>' + escapeHTML(m) + '</span>'; }).join('') + '</div>';
      }
      var equipHTML = '';
      if (ex.equipments && ex.equipments.length > 0) {
        equipHTML = '<div class="exdb-explore-equip">' + HEALTH_ICONS.equipment + ' ' + ex.equipments.map(function(e) { return '<span>' + escapeHTML(e) + '</span>'; }).join('') + '</div>';
      }
      var secondaryHTML = '';
      if (ex.secondaryMuscles && ex.secondaryMuscles.length > 0) {
        secondaryHTML = '<div class="exdb-explore-secondary"><div class="exdb-detail-label">' + HEALTH_ICONS.muscle + ' Secundarios</div><div class="exdb-detail-chips">' + ex.secondaryMuscles.map(function(m) { return '<span class="exdb-chip exdb-chip-secondary">' + escapeHTML(m) + '</span>'; }).join('') + '</div></div>';
      }
      var instructionsHTML = '';
      if (ex.instructions && ex.instructions.length > 0) {
        instructionsHTML = '<div class="exdb-explore-instructions"><div class="exdb-detail-label">' + HEALTH_ICONS.steps + ' Instrucciones</div>' + ex.instructions.map(function(inst, idx) {
          var clean = inst.replace(/^Step:\d+\s*/i, '');
          return '<div class="exdb-instruction-step"><span class="exdb-inst-num">' + (idx + 1) + '</span><span class="exdb-inst-text">' + escapeHTML(clean) + '</span></div>';
        }).join('') + '</div>';
      }

      gridHTML += '<div class="exdb-explore-card">' +
        '<div class="exdb-explore-gif-wrap">' +
          '<img class="exdb-explore-gif" src="' + (ex.gifUrl || '') + '" alt="' + escapeHTML(ex.name) + '" loading="lazy">' +
          '<div class="exdb-explore-gif-fallback">' + HEALTH_ICONS.dumbbell + '</div>' +
        '</div>' +
        '<div class="exdb-explore-info">' +
          '<div class="exdb-explore-name">' + escapeHTML(ex.name) + '</div>' +
          '<div class="exdb-explore-meta">' + musclesHTML + equipHTML + '</div>' +
        '</div>' +
        '<div class="exdb-explore-detail" style="display:none">' + secondaryHTML + instructionsHTML + '</div>' +
      '</div>';
    });

    resultsGrid.innerHTML = gridHTML;

    // Manejar errores de imagen
    resultsGrid.querySelectorAll('.exdb-explore-gif').forEach(function(img) {
      img.addEventListener('error', function() {
        img.style.display = 'none';
        var fallback = img.parentElement.querySelector('.exdb-explore-gif-fallback');
        if (fallback) fallback.style.display = 'flex';
      });
    });

    // Click para expandir
    resultsGrid.querySelectorAll('.exdb-explore-card').forEach(function(card) {
      card.addEventListener('click', function() {
        var detail = card.querySelector('.exdb-explore-detail');
        var isOpen = card.classList.contains('expanded');
        // Cerrar otros
        resultsGrid.querySelectorAll('.exdb-explore-card.expanded').forEach(function(other) {
          if (other !== card) {
            other.classList.remove('expanded');
            var od = other.querySelector('.exdb-explore-detail');
            if (od) od.style.display = 'none';
          }
        });
        card.classList.toggle('expanded');
        if (detail) detail.style.display = isOpen ? 'none' : 'block';
      });
    });
  });
}

// ========================================
// TARJETA DE PLAN RUNNING
// ========================================

function renderRunningPlanCard(runPlan) {
  var card = document.createElement('div');
  card.className = 'health-running-plan-card';

  var levelMap = { 'principiante': 'beginner', 'intermedio': 'intermediate', 'avanzado': 'advanced' };
  var levelClass = levelMap[(runPlan.level || '').toLowerCase()] || 'beginner';

  var html = '<div class="running-plan-header"><div class="running-plan-header-content"><div class="running-plan-icon-wrap"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg></div><div class="running-plan-title-section"><h3 class="running-plan-title">' + escapeHTML(runPlan.name) + '</h3><div class="running-plan-meta">' + (runPlan.level ? '<span class="running-badge ' + levelClass + '">' + escapeHTML(runPlan.level) + '</span>' : '') + (runPlan.weeks ? '<span class="running-badge">' + escapeHTML(runPlan.weeks) + '</span>' : '') + (runPlan.goal ? '<span class="running-badge-goal">' + escapeHTML(runPlan.goal) + '</span>' : '') + '</div></div></div></div>';

  if (runPlan.days && runPlan.days.length > 0) {
    html += '<div class="running-plan-days">';
    runPlan.days.forEach(function(day, idx) {
      var isRest = /descanso|rest/i.test(day.type);
      var dayClass = isRest ? 'running-day-rest' : '';
      html += '<div class="running-day-card ' + dayClass + '"><div class="running-day-header"><div class="running-day-number">' + (idx + 1) + '</div><div class="running-day-info"><div class="running-day-name">' + escapeHTML(day.day) + '</div><div class="running-day-type">' + escapeHTML(day.type) + '</div></div></div>' + (!isRest ? '<div class="running-day-details"><div class="running-detail-item"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><span>' + escapeHTML(day.distance || 'Variable') + '</span></div>' + (day.pace && day.pace !== '---' ? '<div class="running-detail-item"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg><span>' + escapeHTML(day.pace) + '</span></div>' : '') + (day.notes ? '<div class="running-day-notes">' + escapeHTML(day.notes) + '</div>' : '') + '</div>' : '') + '</div>';
    });
    html += '</div>';
  }

  if (runPlan.nutrition) {
    html += '<div class="running-plan-section"><div class="running-plan-section-header"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg><span>Nutrici\u00f3n</span></div><p>' + escapeHTML(runPlan.nutrition) + '</p></div>';
  }

  if (runPlan.tip) {
    html += '<div class="running-plan-tip"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg><span>' + escapeHTML(runPlan.tip) + '</span></div>';
  }

  if (runPlan.warning) {
    html += '<div class="running-plan-warning"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg><span>' + escapeHTML(runPlan.warning) + '</span></div>';
  }

  card.innerHTML = html;
  return card;
}

// ========================================
// TARJETA DE PLAN
// ========================================

function renderPlanCard(plan) {
  var card = document.createElement('div');
  card.className = 'health-plan-card';

  var html = '<div class="health-card-header"><div class="health-card-icon">' + HEALTH_ICONS.calendar + '</div><div class="health-card-title"><h3>' + escapeHTML(plan.name) + '</h3>' + (plan.goal ? '<div class="health-card-subtitle">' + escapeHTML(plan.goal) + '</div>' : '') + '</div></div>';

  if (plan.days && plan.days.length > 0) {
    html += '<div class="health-plan-days">';
    plan.days.forEach(function(day) {
      html += '<div class="health-plan-day"><div class="plan-day-header"><span class="day-name">' + escapeHTML(day.day) + '</span></div><div class="plan-day-meals">' + day.meals.map(function(m) { return '<div class="plan-meal-item">' + escapeHTML(m) + '</div>'; }).join('') + '</div></div>';
    });
    html += '</div>';
  }
  if (plan.tip) {
    html += '<div class="recipe-tip-bar">' + HEALTH_ICONS.tip + ' <span>' + escapeHTML(plan.tip) + '</span></div>';
  }

  card.innerHTML = html;

  card.querySelectorAll('.health-plan-day').forEach(function(dayEl) {
    var header = dayEl.querySelector('.plan-day-header');
    var meals = dayEl.querySelector('.plan-day-meals');
    if (header && meals) {
      header.style.cursor = 'pointer';
      header.addEventListener('click', function() { dayEl.classList.toggle('expanded'); });
    }
  });

  return card;
}

// ========================================
// TARJETA DE BIENESTAR
// ========================================

function renderWellnessCard(wellness) {
  var card = document.createElement('div');
  card.className = 'health-wellness-card';

  var typeIconMap = { 'respiraci\u00f3n': HEALTH_ICONS.wind, 'meditaci\u00f3n': HEALTH_ICONS.heart, 'relajaci\u00f3n': HEALTH_ICONS.heart, 'sue\u00f1o': HEALTH_ICONS.heart };
  var icon = typeIconMap[(wellness.type || '').toLowerCase()] || HEALTH_ICONS.heart;

  var html = '<div class="health-card-header"><div class="health-card-icon">' + icon + '</div><div class="health-card-title"><h3>' + escapeHTML(wellness.name) + '</h3><div class="health-card-badges">' + (wellness.type ? '<span class="health-badge">' + escapeHTML(wellness.type) + '</span>' : '') + (wellness.duration ? '<span class="health-badge">' + HEALTH_ICONS.clock + ' ' + escapeHTML(wellness.duration) + '</span>' : '') + '</div></div></div>';

  if (wellness.steps && wellness.steps.length > 0) {
    html += '<div class="health-section"><div class="recipe-section-header">' + HEALTH_ICONS.steps + ' <span>Pasos</span></div><div class="recipe-steps-flow">';
    wellness.steps.forEach(function(s) {
      html += '<div class="recipe-step-bubble"><div class="step-number-badge">' + escapeHTML(s.number) + '</div><div class="step-content">' + escapeHTML(s.description) + '</div></div>';
    });
    html += '</div></div>';
  }
  if (wellness.benefit) {
    html += '<div class="recipe-tip-bar">' + HEALTH_ICONS.star + ' <span>' + escapeHTML(wellness.benefit) + '</span></div>';
  }

  card.innerHTML = html;
  return card;
}

// ========================================
// LIMPIAR TAGS
// ========================================

function cleanHealthTags(content) {
  var c = content;
  // Bloques completos
  c = c.replace(/\[HEALTH_(?:RECIPE|ROUTINE|PLAN|WELLNESS|SUGGESTIONS|RUNNING_PLAN)\][\s\S]*?\[\/HEALTH_(?:RECIPE|ROUTINE|PLAN|WELLNESS|SUGGESTIONS|RUNNING_PLAN)\]/g, '');
  // Bloques abiertos (streaming)
  c = c.replace(/\[HEALTH_(?:RECIPE|ROUTINE|PLAN|WELLNESS|SUGGESTIONS|RUNNING_PLAN)\][\s\S]*/g, '');
  // Tags individuales con brackets
  c = c.replace(/\[(?:RECIPE|ROUTINE|PLAN|WELLNESS|SUGGESTION|RUNNING)_?[A-Z_]*:[^\]]*\]/g, '');
  c = c.replace(/\[SUGGESTION:[^\]]*\]/g, '');
  // Tags formato B
  c = c.replace(/\[RECIPE_STEP:\d+\][^\[\n]*/g, '');
  c = c.replace(/\[WELLNESS_STEP:\d+\][^\[\n]*/g, '');
  // Exercise explorer
  c = c.replace(/\[HEALTH_EXERCISE_EXPLORER\]/g, '');
  // Tags sueltos
  c = c.replace(/\[\/?HEALTH_[A-Z_]+\]/g, '');
  // Tags sin brackets
  c = c.replace(/^\s*(?:RECIPE_TIP|ROUTINE_TIP|PLAN_TIP|RUNNING_TIP|RUNNING_NUTRITION|RUNNING_WARNING):.*$/gm, '');
  // Limpiar
  c = c.replace(/^\s*[-*\u25E6]\s*$/gm, '');
  c = c.replace(/\n{3,}/g, '\n\n');
  return c.trim();
}

// ========================================
// UTILIDADES
// ========================================

function escapeHTML(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function parseSimpleMarkdown(str) {
  if (!str) return '';
  // Escapar HTML primero
  var escaped = escapeHTML(str);
  // Parsear markdown básico
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>'); // **negrita**
  escaped = escaped.replace(/\*([^*]+)\*/g, '<em>$1</em>'); // *cursiva*
  escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>'); // `código`
  return escaped;
}

// ========================================
// EXPORTAR
// ========================================

window.healthMode = {
  parseCommands: parseHealthCommands,
  renderComponents: renderHealthComponents,
  getSystemPrompt: getHealthSystemPrompt,
  hasContent: hasHealthContent,
  cleanTags: cleanHealthTags,
  getProfile: getHealthProfile,
  saveProfile: saveHealthProfile,
  renderExerciseExplorer: renderExerciseExplorer,
  searchExercise: fetchExercisesByName,
  getState: function() { return healthState; },
  setActive: function(active) {
    window._healthModeActive = active;
    console.log(active ? 'Modo Salud activado' : 'Modo Salud desactivado');
  },
  init: function() { console.log('Modulo de Salud v3.0 - ExerciseDB integrado'); }
};

document.addEventListener('DOMContentLoaded', function() {
  var setup = function() {
    document.querySelectorAll('.chat-mode-option[data-mode="health"]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        window.healthMode.setActive(true);
        window._studyModeActive = false;
        window._webSearchModeActive = false;
        window._musicModeActive = false;
        window._travelModeActive = false;
      });
    });
    document.querySelectorAll('.chat-mode-option:not([data-mode="health"])').forEach(function(btn) {
      btn.addEventListener('click', function() {
        if (window.healthMode) window.healthMode.setActive(false);
      });
    });
  };
  setup();
  setTimeout(setup, 1000);
});

console.log('Modulo de Salud v3.0 - ExerciseDB');
