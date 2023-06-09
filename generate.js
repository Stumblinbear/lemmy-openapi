const execSync = require("child_process").execSync;

const fs = require("fs/promises");

const OPENAPI_TEMPLATE = {
  openapi: "3.0.0",
  info: {
    title: "Lemmy API",
    version: "3",
  },
  servers: [
    {
      url: "https://lemmy.ml/api/v3",
      description: "Official Lemmy server",
    },
  ],
  tags: [],
  paths: {},
  components: {
    parameters: {},
    schemas: {
      AuthToken: {
        title: "AuthToken",
        type: "string",
      },
      SiteActorId: {
        title: "SiteActorId",
        type: "string",
      },
      CommunityActorId: {
        title: "CommunityActorId",
        type: "string",
      },
      PersonActorId: {
        title: "PersonActorId",
        type: "string",
      },
      PostActivityPubId: {
        title: "PersonActivityPubId",
        type: "string",
      },
      CommentActivityPubId: {
        title: "CommentActivityPubId",
        type: "string",
      },
      PrivateMessageActivityPubId: {
        title: "PrivateMessageActivityPubId",
        type: "string",
      },
      Error: {
        title: "Error",
        type: "object",
        properties: {
          error: {
            type: "string",
          },
        },
      },
    },
  },
};

const DATETIME_FIELDS = new Set(["when_", "published", "updated"]);

const PATCHES = {
  components: {
    schemas: {
      Site: {
        properties: {
          actor_id: {
            $ref: "#/components/schemas/SiteActorId",
          },
          name: {
            example: "Lemmy Site",
          },
          description: {
            example: "I'm a site",
          },
          private_key: {
            example: "weee",
          },
          public_key: {
            example: "wooo",
          },
        },
      },
      Community: {
        properties: {
          actor_id: {
            $ref: "#/components/schemas/CommunityActorId",
          },
        },
      },
      Person: {
        properties: {
          actor_id: {
            $ref: "#/components/schemas/PersonActorId",
          },
        },
      },
      Post: {
        properties: {
          ap_id: {
            $ref: "#/components/schemas/PostActivityPubId",
          },
        },
      },
      Comment: {
        properties: {
          ap_id: {
            $ref: "#/components/schemas/CommentActivityPubId",
          },
        },
      },
      PrivateMessage: {
        properties: {
          ap_id: {
            $ref: "#/components/schemas/PrivateMessageActivityPubId",
          },
        },
      },
      UploadImage: {
        properties: {
          image: {
            anyOf: undefined,
            description: "The image to upload",
            type: "string",
            format: "byte",
          },
        },
      },
    },
  },
  paths: {
    "/user/login": {
      post: {
        responses: {
          400: {
            description: "Invalid login",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
          404: {
            description: "Not found",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
    },
  },
};

(async () => {
  await fs.rm("./temp", { force: true, recursive: true });

  await fs.mkdir("./temp", { recursive: true });

  // Combine all the types into one file
  for (const fileName of await fs.readdir("./lemmy-js-client/src/types")) {
    let contents = await fs.readFile(
      `./lemmy-js-client/src/types/${fileName}`,
      "utf-8"
    );

    // Remove the first line from the file, which is the "Generated from " line
    contents = contents.replace(/.*\n/, "");

    // Remove the imports from the file
    contents = contents.replace(/import.*from.*;/g, "");

    await fs.appendFile("./temp/types-all.ts", contents);
  }

  execSync(`npx typeconv -v -f ts -t oapi --oapi-format json types-all.ts`, {
    cwd: "./temp",
  });

  const openapiSpec = structuredClone(OPENAPI_TEMPLATE);

  const {
    components: { schemas },
  } = require(`./temp/types-all.json`);

  // Extract the paths and functions from the `http.ts` file
  const clientFile = (
    await fs.readFile("./lemmy-js-client/src/http.ts")
  ).toString();

  const matches = clientFile.split("constructor(", 2)[1].matchAll(
    // Black magic to extract the necessary data from each of the functions
    /\/\*\*.+?\* (.+?)\n.+?`HTTP.(.+?) (.+?)`.+?\*\/.+?(\w+?)\(.+?: (.+?)\) \{.+?,(.+?)\>/gms
  );

  for (const match of matches) {
    let [, description, method, path, functionName, schemaName, returnType] =
      match;

    description = description.trim();
    method = method.trim();
    path = path.trim();
    functionName = functionName.trim();
    schemaName = schemaName.trim();
    returnType = returnType.trim();

    let tag = path.split("/")[1];

    if (tag === "modlog") {
      tag = "mod";
    }

    // Conver the snake_case tag to Title Case
    tag = tag
      .split("_")
      .map((word) => word[0].toUpperCase() + word.slice(1))
      .join(" ");

    openapiSpec.paths[path] = {
      ...(openapiSpec.paths[path] ?? {}),
      [method.toLowerCase()]: {
        tags: [tag],

        description,
        operationId: functionName,

        ...(method.toLowerCase() === "get"
          ? {
              parameters: `<parameters:${schemaName}>`,
            }
          : {
              requestBody: {
                content: {
                  "application/json": {
                    schema: {
                      $ref: `#/components/schemas/${schemaName}`,
                    },
                  },
                },
              },
            }),

        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  $ref: `#/components/schemas/${returnType}`,
                },
              },
            },
          },
        },
      },
    };
  }

  const parameters = {};

  // Grab any references to parameters in the schema
  for (const [path, pathSchema] of Object.entries(openapiSpec.paths)) {
    if (
      !(
        "get" in pathSchema &&
        "parameters" in pathSchema.get &&
        typeof pathSchema.get.parameters === "string"
      )
    ) {
      continue;
    }

    const parametersSchemaName = pathSchema.get.parameters
      .replace("<parameters:", "")
      .replace(">", "");

    const paramArray = [];

    parameters[parametersSchemaName] = paramArray;

    pathSchema.get.parameters = paramArray;
  }

  // Extract the components from the file
  for (let [schemaName, schema] of Object.entries(schemas)) {
    if (schema.properties) {
      for (const [propertyName, property] of Object.entries(
        schema.properties
      )) {
        // Property titles are generated with the schema name as a prefix, which we don't want
        property.title = propertyName.replace(`${schemaName}.`, "");

        if (propertyName === "auth" || propertyName === "jwt") {
          delete property.type;

          property["$ref"] = "#/components/schemas/AuthToken";
        }

        if (property["$ref"] || property.title === propertyName) {
          // No need to include a title if the property is a reference or if they're the same
          delete property.title;
        }

        if (property.type === "string" && DATETIME_FIELDS.has(propertyName)) {
          property.type = "string";
          property.format = "date-time";
        }
      }
    }

    // If this schema is referenced as a parameter, populate the parameters object and don't add it to schemas
    if (schemaName in parameters) {
      for (const [propertyName, property] of Object.entries(
        schema.properties
      )) {
        const isRequired = schema.required?.includes(propertyName) ?? false;

        parameters[schemaName].push({
          in: "query",
          name: propertyName,
          required: isRequired,
          schema: property,
        });
      }

      continue;
    }

    // Add the schema to the openapi spec
    openapiSpec.components.schemas[schemaName] = schema;
  }

  // Apply schema patches
  for (const [schemaName, patch] of Object.entries(
    PATCHES.components.schemas
  )) {
    const { title, example, properties } = patch;

    const schemaSpec = openapiSpec.components.schemas[schemaName];

    // Add the schema to the openapi spec
    if (title) {
      schemaSpec.title = title;
    }

    if (example) {
      schemaSpec.example = example;
    }

    if (properties) {
      for (const [propertyName, propertyPatch] of Object.entries(properties)) {
        if (propertyPatch["$ref"]) {
          schemaSpec.properties[propertyName] = propertyPatch;
        } else {
          schemaSpec.properties[propertyName] = {
            ...schemaSpec.properties[propertyName],
            ...propertyPatch,
          };
        }
      }
    }
  }

  // Apply path patches
  for (const [path, patchMethods] of Object.entries(PATCHES.paths)) {
    for (const [method, methodPatch] of Object.entries(patchMethods)) {
      const methodSpec = openapiSpec.paths[path][method];

      methodSpec.responses = {
        ...methodSpec.responses,
        ...(methodPatch.responses ?? {}),
      };
    }
  }

  await fs.writeFile("./openapi.json", JSON.stringify(openapiSpec, null, 2));
})();
