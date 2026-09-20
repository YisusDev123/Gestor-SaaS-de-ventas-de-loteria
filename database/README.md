# Migraciones de base de datos

Estado vigente: 11 archivos versionados (`001`–`011`) y 39 tablas después de incluir `schema_migrations`. La doble ejecución y el inventario completo están validados sobre `saas_jps_test` y staging.

Las migraciones se aplican en orden numérico y su checksum queda registrado en `schema_migrations`. Un archivo aplicado no debe editarse; cualquier cambio posterior requiere una migración nueva.

El runner usa un advisory lock de MySQL para impedir dos ejecuciones simultáneas. Los archivos SQL son locales y confiables; por eso la conexión exclusiva de migración habilita múltiples sentencias. La API normal no debe habilitar esa opción.

Para ejecutar contra una base preparada expresamente:

```powershell
$env:ALLOW_DB_MIGRATION='true'
npm run db:migrate
```

La estructura de archivos y las reglas críticas pueden comprobarse sin conectarse a MySQL:

```powershell
npm run db:validate
```

La base indicada por `MYSQL_DB` debe existir previamente y el usuario debe poseer únicamente los permisos necesarios para migrarla. No se deben colocar credenciales reales en archivos versionados ni ejecutar migraciones automáticamente durante el arranque normal.

La primera migración de producción se ejecuta únicamente mediante la ventana del Gate 3 de `RUNBOOK_PRODUCCION.md`; después se devuelve `ALLOW_DB_MIGRATION=false` y se retira el pre-deploy temporal.

Para crear y verificar la base aislada `saas_jps_test` usando un archivo local de credenciales sin copiar sus secretos al proyecto:

```powershell
$env:NODE_ENV='test'
$env:ALLOW_DB_TEST_BOOTSTRAP='true'
$env:SAAS_TEST_CREDENTIALS_FILE='C:\ruta\a\credenciales-locales.env'
npm run db:test:bootstrap
```

El nombre de la base está fijado dentro del script. El comando no elimina bases ni tablas y nunca apunta automáticamente a la base configurada en el archivo de credenciales.
