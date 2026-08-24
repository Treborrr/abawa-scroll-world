# Abawa — brief para la landing scroll-world

## Marca
- **Nombre:** Abawa — chocolate bean-to-bar, cacao nativo de Amazonas. "From Amazonas to the bar."
- **Propósito:** honrar el trabajo de quienes cultivan y preservan el cacao nativo de Amazonas; transformar el chocolate en un símbolo de reconocimiento consciente.
- **Diferenciales:** micro-lotes, trazabilidad evidenciada, conexión genuina con el productor, talleres vivenciales, experiencia sensorial completa, chocolate fino de aroma y alta pureza.
- **Tono:** femenina, pulcra, delicada, empática, inspiradora, premium.

## Paleta (RGB, con % de uso del manual)
| Color | Hex | Uso |
|---|---|---|
| Crema | `#f0ebe3` | 40% |
| Marrón | `#49403b` | 30% |
| Lila | `#b7b6cc` | 25% |
| Verde salvia pálido | ~`#d5e6cf` (aprox., hex truncado en el PDF) | 5% |
| Oro | `#9a8555` | 5% |

## Tipografía (solo capa HTML — los renders no llevan texto)
- Primaria: Restora Neue (otf en Branding ABAWA/3.ELEMENTOS/3.2-3.4_TIPOGRAFÍA/Primaria)
- Secundaria: Oxygen (ttf, misma carpeta /secundaria)

## Decisiones del build
- Backend: **fal.ai** (API key del usuario). Stills: gpt-image-2. Video: Kling image-to-video (endpoint con frame inicial + final).
- Peticiones a fal **en serie** (en paralelo da falsos errores de saldo).
- Clips de **5 segundos**. Cámara: "volar por el mundo" (arquitectura B: dive + conector aéreo).
- Arte: clay diorama — low-poly mate tipo arcilla, isométrico, tilt-shift miniatura, luz cálida.
- Solo escritorio (16:9), sin cadena móvil 9:16.
- Escenas: pendiente de definir con el usuario (planificación en curso).
