# Publicar Mi Salón en Railway

Esta aplicación necesita Node.js y almacenamiento persistente (no basta con subir el HTML).

1. Descomprime este ZIP y sube **el contenido de la carpeta** `mi-salon-colorido` a un repositorio nuevo de GitHub. No subas el ZIP como único archivo.
2. En https://railway.com crea un proyecto (**New Project**) y selecciona **Deploy from GitHub repo**, conectando tu repositorio.
3. En el servicio, en **Variables**, agrega `NODE_ENV=production` y `DATA_DIR=/data`.
4. Conecta un **Volume** de Railway al servicio con punto de montaje `/data`. Esto es imprescindible: sin él, se pueden perder los cumpleaños, tareas, mensajes y usuarios al redesplegar. Consulta https://docs.railway.com/volumes .
5. Configura una sola réplica/instancia del servicio. La app usa SQLite y no debe dividirse entre múltiples réplicas con este diseño.
6. En **Settings → Networking**, elige **Generate Domain**, espera a que el despliegue esté activo y abre la dirección HTTPS que te otorgue Railway.
7. Prueba con dos usuarios distintos: registra nombre, fecha de nacimiento y PIN; publica una tarea y un mensaje; verifica que el segundo usuario pueda verlos pero no editarlos. Comprueba que el cumpleaños aparece en la sección correspondiente.
8. Activa respaldos periódicos del volumen y revisa los costos del proveedor antes de compartir el enlace con el salón.

**Importante:** el nombre y PIN no demuestran identidad real; cualquier persona con el enlace podría intentar registrar nombres si aún están disponibles. Considera un código de invitación o un proceso de verificación antes de usarlo con datos de estudiantes. La fecha completa de nacimiento es un dato personal; pide consentimiento y muestra solo día y mes en el listado general. Este proyecto aún no está publicado y no tiene recuperación automática de PIN.

Documentación: https://docs.railway.com/quick-start
