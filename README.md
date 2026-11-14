# Mi Salón 🌈

Sitio web para un grupo escolar con diseño colorido, registro individual, cumpleaños automáticos, tareas compartidas y chat grupal. **No existen cuentas administradoras.**

## Características

- Cada compañero **se registra** con nombre, fecha de cumpleaños y PIN de 6 a 8 dígitos.
- En visitas posteriores **inicia sesión** con nombre y PIN.
- Su fecha de cumpleaños aparece automáticamente en el apartado general; solo puede cambiar la suya.
- Todos pueden leer tareas y mensajes, pero **solo quien los publicó** puede editarlos o borrarlos (la verificación ocurre en el servidor, no únicamente en la interfaz).
- El chat se actualiza aproximadamente cada 3.5 segundos (no requiere recargar la página).
- Al cerrar y abrir el navegador, la sesión puede mantenerse hasta 30 días.
- La información se guarda en una base de datos SQLite local del servidor (`data/salon.sqlite`).

## Empezar

Necesitas **Node.js 20 o superior** (idealmente Node 22 LTS) y npm.

```bash
npm install
npm start
```

Abre **http://localhost:3000**. Si quieres verlo desde otra computadora en la misma red Wi-Fi, visita la IP local de la computadora que ejecuta el servidor y puerto 3000, siempre que el firewall lo permita.

Para cambiar el puerto:

```bash
PORT=4000 npm start
```

## Compartir en internet

El archivo HTML **no se puede publicar por separado** en un hosting estático porque necesita el servidor de Node.js y la base SQLite para conservar identidades y publicaciones. Aloja el proyecto completo en un proveedor que admita servidores Node.js **y almacenamiento persistente** (disco/volumen), configura `DATA_DIR` en el volumen y usa HTTPS. Se debe tener un solo proceso servidor para la base SQLite. Si el proveedor no ofrece disco persistente, cambia la base de datos por una gestionada antes de usarlo.

## Seguridad y limitaciones

- No existe administrador: todos los alumnos tienen el mismo nivel de acceso.
- El PIN se almacena cifrado con hash bcrypt; la sesión usa una cookie HttpOnly y un token aleatorio.
- El registro con nombres similares o suplantación inicial sigue siendo posible: confirma presencialmente los nombres y PIN de cada alumno al incorporarlos. Si se pierde el PIN, esta versión no dispone de recuperación automática.
- El **PIN de 6–8 dígitos no ofrece la seguridad de una contraseña fuerte**. Hay un límite general de intentos, pero para una instalación pública con muchos usuarios es preferible añadir comprobación de identidad, contraseñas más robustas y protección contra intentos distribuidos.
- No se puede asegurar que cada nombre corresponda al alumno real sin un procedimiento adicional de verificación.
- Los cumpleaños muestran día, mes y nombre a otros usuarios del sitio. El año se almacena pero no se muestra.
- El contenido no está cifrado de extremo a extremo. Evita datos sensibles y configura copias de seguridad.
- La solución no cuenta todavía con subida de archivos, notificaciones ni recuperación de PIN.

## Estructura

- `server.js`: API, sesiones, permisos, base de datos.
- `public/index.html`: interfaz.
- `public/style.css`: estilos y adaptación a celular.
- `public/app.js`: navegación, formularios, actualizaciones de chat.
- `data/`: carpeta local de base de datos creada automáticamente al ejecutar.

## Guía rápida para publicar

Consulta `PUBLICAR.md` para desplegar Mi Salón en Railway, con base de datos persistente.
