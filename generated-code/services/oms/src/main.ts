import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  // Initialize the main NestJS application (for REST/GraphQL endpoints)
  const app = await NestFactory.create(AppModule);

  // Enable global validation pipe for incoming requests
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // Configure Kafka Microservice listener
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.KAFKA,
    options: {
      client: {
        clientId: 'oms-service',
        brokers: [process.env.KAFKA_BROKERS || 'localhost:9092'],
      },
      consumer: {
        groupId: 'oms-consumer-group',
        allowAutoTopicCreation: true,
      },
    },
  });

  // Enable graceful shutdown hooks to safely disconnect from Kafka
  app.enableShutdownHooks();

  // Start listening to microservice events (Kafka)
  await app.startAllMicroservices();

  // Start the HTTP server (for Admin/Vendor REST APIs)
  const port = process.env.PORT || 3001;
  await app.listen(port);
  
  console.log(`OMS Service is running on port: ${port}`);
  console.log(`OMS Kafka Consumer connected to brokers: ${process.env.KAFKA_BROKERS || 'localhost:9092'}`);
}

bootstrap();
