let http = require("http")
let fs = require("fs")
let timers = require("timers")
let ws = require("ws")

halfCarHeight = 50
halfCarWidth = halfCarHeight / 2

FORWARD = 0
BACKWARD = 1

CARS = ["Car1", "Car2", "Car3", "Car4"]

IP_CREATE_TABLE = {}

/*
 * Car properties:
 *      name : String           The name of the car
 *      img : String            The image of the car. Implicit ".png" is added to the end
 *      pos : {                 The position of the car
 *          x : float, 
 *          y : float
 *      }
 *      rot : float             The rotation of the car
 *      steering : float        How much the car rotates every tick
 *      accel : float           How fast the car accelerates. Changes the speed field
 *      speed : float           How fast the car moves every tick
 *      maxSpeed : float        Limits the speed
 *      hand_breaks : bool      If the hand breaks are down. If so, the car decelerates by break_strength every second
 *      break_strength : float  How much the car breaks every second if the hand_breaks are down
 *      crashed : bool          Has the car crashed? Loads a different texture if so
 *      fade : float            How much the car is fading away. 1 is no fade. Decreases when the ai is disabled and no one is driving the car
 *      ai : {                  The brain of the car. Optional
 *          road_queue : [          A list of roads that the car follows
 *              {road : int             The index of the road to follow
 *              backwards :  bool       If true, the car drives towards the start of the road
 *              }
 *          ]
 *          waiting : bool      If the car is waiting for at a traffic light
 *      }
 *      controlled_by : string  If the car is controlled by a player, this is that player's IP address.
 */


function init() {
    traffic = {
        cars: [ ],
        roads: [
            {width: 1.5, start: {x: 12, y: 32}, end: {x: 12, y: 12}, connected_to: [3,5,7], speed_rec: 5, traffic_light: {green_left: 0, last_green: 0, offset: {x: 1, y: 1}}}, // Goes upwards
            {width: 1.5, start: {x: 10, y: 12}, end: {x: 10, y: 32}, connected_to: [], speed_rec: 5},
            {width: 1.5, start: {x: -10, y: 12}, end: {x: 10, y: 12}, connected_to: [1,5,7], speed_rec: 5, traffic_light: {green_left: 0, last_green: 0, offset: {x: -1, y: 1}}}, // Goes to the right
            {width: 1.5, start: {x: 10, y: 10}, end: {x: -10, y: 10}, connected_to: [], speed_rec: 5},
            {width: 1.5, start: {x: 10, y: -10}, end: {x: 10, y: 10}, connected_to: [1,3,7], speed_rec: 5, traffic_light: {green_left: 0, last_green: 0, offset: {x: -1, y: -1}}}, // Goes downwards
            {width: 1.5, start: {x: 12, y: 10}, end: {x: 12, y: -10}, connected_to: [], speed_rec: 5},
            {width: 1.5, start: {x: 33, y: 10}, end: {x: 12, y: 10}, connected_to: [1,3,5], speed_rec: 5, traffic_light: {green_left: 0, last_green: 0, offset: {x: 1, y: -1}}}, // Goes to the left
            {width: 1.5, start: {x: 12, y: 12}, end: {x: 32, y: 12}, connected_to: [8], speed_rec: 5},
            {width: 1.3, start: {x: 32, y: 12}, end: {x: 37, y: 17}, connected_to: [9], speed_rec: 5},
            {width: 1.3, start: {x: 37, y: 17}, end: {x: 42, y: 17}, connected_to: [], speed_rec: 5},
            {width: 1.3, start: {x: 38, y: 15}, end: {x: 33, y: 10}, connected_to: [6], speed_rec: 5},
            {width: 1.3, start: {x: 42, y: 15}, end: {x: 38, y: 15}, connected_to: [10], speed_rec: 5},
        ],
        intersections: [
            {roads: [0, 2, 4, 6]}
        ],
        timeUntilNextCar: 0
    }
}


DEBUG = false

init()

lastTime = Date.now()
totalTime = 0
carCount = 0

toRadians = (theta => theta * Math.PI / 180)
toDegrees = (theta => theta * 180 / Math.PI)

function distance(a, b) {
    dx = a.x - b.x
    dy = a.y - b.y
    return Math.sqrt(dx * dx + dy * dy)
}

var physics = timers.setInterval(() => {
    delta = (Date.now() - lastTime) / 1000
    totalTime += delta
    lastTime = Date.now()

    traffic.roads.forEach(road => {
        if (!road.traffic_light)
            return
        road.traffic_light.waiting_cars = []

        if (road.traffic_light.green_left > 0) {
            road.traffic_light.green_left -= delta

            if (road.traffic_light.green_left <= 0) {
                road.traffic_light.green_left = 0
            }
        }
    })

    traffic.cars = traffic.cars.map(car => {
        theta = toRadians(car.rot)
        rx = Math.cos(theta) * delta * car.speed
        ry = Math.sin(theta) * delta * car.speed
        new_pos = {x: car.pos.x + rx, y: car.pos.y + ry}
        car.pos = new_pos

        car.speed += car.accel * delta

        // if (car.speed > car.maxSpeed)
        //     car.speed = car.maxSpeed

        car.rot += car.steering * delta

        if (!car.crashed && traffic.cars.filter(car2 => car != car2 && distance(car.pos, car2.pos) < 0.8).length > 0) {
            car.crashed = true
            car.speed *= -1
            delete car.ai
            car.accel = 0
            delete car.controlled_by
        }

        // Calculate AI
        if (!car.crashed && car.ai && car.ai.road_queue.length > 0) {
            current_path = car.ai.road_queue[0]

            road = traffic.roads[current_path.road]
            road_delta = {x: road.end.x - road.start.x, y: road.end.y - road.start.y}
            road_rot = toDegrees(Math.atan2(road_delta.y, road_delta.x))

            if (road_delta.x == 0) {
                k = 1 / 0
                m = 0
                cx = road.start.x
                cy = car.pos.y
            }
            else {
                k = road_delta.y / road_delta.x
                m = road.start.y - k * road.start.x

                cx = (car.pos.x + k * car.pos.y - k * m) / (1 + k * k)
                cy = k * cx + m
            }
            closest = {x:cx, y:cy}
            if (distance(closest, road.start) + distance(closest, road.end) > distance(road.start, road.end)) {
                if (distance(closest, road.start) < distance(closest, road.end))
                    closest = road.start
                else
                    closest = road.end
            }

            dist = distance(car.pos, closest)
            dist_exag = Math.exp(3 * dist)

            // Steer car towards closest point
            wanted_end_pos = current_path.direction == FORWARD ? road.end : road.start

            wanted_rot = (toDegrees(Math.atan2(car.pos.y - (closest.y * dist_exag + wanted_end_pos.y) / (dist_exag + 1), car.pos.x - (closest.x * dist_exag + wanted_end_pos.x) / (dist_exag + 1)))) % 360 + 180


            car.steering = (wanted_rot - car.rot)

            car.steering = ((car.steering + 180) % 360 - 180) * 5

            dwx = wanted_end_pos.x - car.pos.x
            dwy = wanted_end_pos.y - car.pos.y
            dist_to_finish = Math.sqrt(dwx * dwx + dwy * dwy)

            // How far would the car go if the breaks were all down? Use the geometric series b+b^2+b^3... where b = break factor
            break_dist = 2 * (car.speed * car.break_strength / (1 + car.break_strength) + 1)

            // What cars are in front?
            cars_in_front = traffic.cars.filter(check => {
                if (check === car)
                    return false

                if (distance(car.pos, check.pos) > break_dist * 1.5)
                    return false

                pos_delta = {x: car.pos.x - check.pos.x, y: car.pos.y - check.pos.y}
                delta_angle = toDegrees(Math.atan2(pos_delta.y, pos_delta.x))
                angle_diff = car.rot - delta_angle + 180

                while (angle_diff > 180)
                    angle_diff -= 360


                return Math.abs(angle_diff) < 15
            })

            car.hand_breaks = false

            if (road.traffic_light) {
                car.ai.waiting = true
            }
            else {
                car.ai.waiting = false
            }

            // Check if there's a traffic light
            if (road.traffic_light && road.traffic_light.green_left <= 0 && dist_to_finish < break_dist * 1.5) {
                car.hand_breaks = true
                car.accel = (dist_to_finish - break_dist * 1.5) / 3
            }

            else if (cars_in_front.length > 0) {
                if (DEBUG)
                    console.log(car.name + " is behind " + cars_in_front.map(car => car.name))
                // Match the speed
                avg_speed = cars_in_front.map(check_car => check_car.speed * Math.cos(toRadians(check_car.rot - car.rot))).reduce((a, b) => a + b) / cars_in_front.length
                min_dist = cars_in_front.map(check_car => distance(car.pos, check_car.pos)).reduce((a, b) => a < b ? a : b)

                if (avg_speed < car.speed - 4 && avg_speed > 0) {
                    car.hand_breaks = true
                }

                car.accel = (avg_speed - car.speed) * 3

                if (min_dist < 5 && avg_speed > 0) {
                    car.hand_breaks = true
                    car.accel = 0
                }

                any_waiting = cars_in_front.map(car => car.ai && car.ai.waiting).reduce((a, b) => (a || b))
                car.ai.waiting |= any_waiting
            }
            else {
                car.accel = (road.speed_rec - car.speed) * 5
                if (DEBUG)
                    console.log(car.name + " is accelling from " + car.speed + " to " + road.speed_rec + " with " + car.accel)
            }
            if (road.traffic_light && car.ai.waiting) {
                road.traffic_light.waiting_cars.push(car)
            }

            if (dist_to_finish < 1) {
                car.ai.road_queue.shift()
                if (car.ai.road_queue.length == 0) {
                    delete car.ai
                }
            }

            car.fade = 1
        }
        if (!car.ai && !car.controlled_by && !car.non_fade || car.crashed) {
            car.hand_breaks = true
            car.fade -= delta / 3
        }

        if (car.hand_breaks) {
            car.speed *= Math.pow(car.break_strength, delta)
            if (Math.abs(car.speed) < 0.3) {
                car.speed = 0
            }
            car.steering /= Math.pow(5, delta)
        }

        return car
    }).filter(car => car.fade > 0)

    traffic.intersections.forEach(intersection => {
        any_green = false

        max_score = 0
        max_cars_idx = []
        roads = intersection.roads

        for (i = 0; i < roads.length; i++) {
            r = roads[i]
            road = traffic.roads[r]

            if (!road.traffic_light)
                continue

            amount_of_cars = road.traffic_light.waiting_cars.length

            score = amount_of_cars

            if (road.traffic_light.green_left > 0) {
                any_green = true
                max_cars_idx = [r]
                break
            }

            if (score == max_score) {
                max_cars_idx.push(r)
            }

            if (score > max_score) {
                max_cars_idx = [r]
                max_score = score
            }
        }
        
        if (!any_green && max_cars_idx.length > 0) {
            console.log(max_cars_idx)
            selected_idx = max_cars_idx[Math.random() * max_cars_idx.length | 0]

            light = traffic.roads[selected_idx].traffic_light
            light.green_left = light.waiting_cars.length + 2
            light.last_green = totalTime
        }
        

    })

    traffic.timeUntilNextCar -= delta
    if (traffic.timeUntilNextCar <= 0) {
        traffic.timeUntilNextCar = 1

        // Add new car

        texture = CARS[Math.random() * CARS.length | 0]
        attempt = 50

        do {
            road_idx = Math.random() * traffic.roads.length | 0
            attempt -= 1
        } while (
            attempt > 0 && (
                traffic.roads.map(road => road.connected_to.indexOf(road_idx) != -1).reduce((a, b) => a || b) ||
                traffic.cars.length > 0 && !traffic.cars.map(car => distance(car.pos, traffic.roads[road_idx].start) > 2).reduce((a, b) => a && b)
            )
        )
        if (attempt != 0) {
            road = traffic.roads[road_idx]
            road_rot = toDegrees(Math.atan2(road.end.y - road.start.y, road.end.x - road.start.x))

            path = []
            current_road_idx = road_idx
            for (i = 0; i < 10 && traffic.roads[current_road_idx].connected_to.length > 0; i++) {
                path.push({road: current_road_idx, direction: FORWARD})

                current_road = traffic.roads[current_road_idx]
                current_road_idx = current_road.connected_to[Math.random() * current_road.connected_to.length | 0]

            }
            path.push({road: current_road_idx, direction: FORWARD})

            car = {
                name: "Car" + carCount,
                img: texture,
                pos: road.start,
                rot: road_rot,
                accel: 0,
                speed: 0,
                maxSpeed: 8,
                steering: 0,
                hand_breaks: false,
                break_strength: 0.2,
                crashed: false,
                ai: {
                    waiting: false,
                    road_queue: path
                },
            }
            traffic.cars.push(car)
            
            carCount += 1
        }
    }

    // if (totalTime > 20) {
    //     totalTime = 0
    //     init()
    //     console.log("Reset!")
    // }
}, 40)

var server = http.createServer((req, res) => {
    method = req.method
    url = req.url
    ip  = req.connection.remoteAddress
    if (method === "GET") {
        filePath = "Web" + url
        if (fs.existsSync(filePath)) {
            console.log(method + " " + url)
            if (!fs.lstatSync(filePath).isFile()) {
                filePath = "Web/traffic.html"
            }
            content = fs.readFileSync(filePath)
            res.setHeader("Content-Type", "text/html")
            res.end(content)
        } else {
            console.log(method + " " + url + " (NOEXIST!)")
            res.end("NOEXIST!")
        }
    }
})

server.listen(8000)
console.log("Started")

var wss = new ws.Server({server: server})

var broadcast = timers.setInterval(() => {
    wss.clients.forEach(client => {
        if (client.readyState === ws.OPEN) {
            ip = client.upgradeReq.connection.remoteAddress
            traffic["ip"] = ip
            client.send(JSON.stringify(traffic))
        }
        delete traffic["ip"]
    })   
}, 100)

wss.on('connection', (socket => {

    socket.on('message', (data, flags) => {
        ip = socket.upgradeReq.connection.remoteAddress
        if (IP_CREATE_TABLE[ip] >= 20) {
            return
        }

        console.log("Recieved " + data + " from " + ip)
        parts = data.split("/")
        if (parts.length > 0) {
            cmd = parts[0]
            if (cmd === "claim" && parts.length > 1) {
                carName = parts[1]
                cars = traffic.cars.filter(car => car.name == carName)
                cars.forEach(car => car.controlled_by = ip)
                console.log(ip + " claimed " + cars.map(car => car.name))
            }
            if (cmd === "create" && parts.length > 2) {
                x = parseFloat(parts[1])
                y = parseFloat(parts[2])

                texture = CARS[Math.random() * CARS.length | 0]

                car = {
                    name: "Car" + carCount++,
                    img: texture,
                    pos: {x: x, y: y},
                    rot: 0,
                    accel: 0,
                    speed: 0,
                    maxSpeed: 8,
                    steering: 0,
                    hand_breaks: false,
                    break_strength: 0.2,
                    fade: 1,
                    non_fade: true,
                    crashed: false,
                    controlled_by: ip
                }

                traffic.cars.push(car)

                if (ip !== "::1") {
                    if (IP_CREATE_TABLE[ip] > 0) {
                        IP_CREATE_TABLE[ip] += 1
                    }
                    else {
                        IP_CREATE_TABLE[ip] = 1
                    }

                }
            }
            else {
                cars = traffic.cars.filter(car => car.controlled_by === ip)

                if (cmd === "steer" && parts.length > 1) {
                    rot = parseFloat(parts[1])
                    cars.forEach(car => car.steering = rot)
                    console.log("Steering: " + cars.map(car => car.steering))
                }
                if (cmd === "accel" && parts.length > 1) {
                    accel = parseFloat(parts[1])
                    cars.forEach(car => car.accel = accel)
                    console.log("Steering: " + cars.map(car => car.accel))
                }
                if (cmd === "breaks") {
                    cars.forEach(car => car.hand_breaks = true)
                    console.log("Steering: " + cars.map(car => car.hand_breaks))
                }
                if (cmd === "no_breaks") {
                    cars.forEach(car => car.hand_breaks = false)
                    console.log("Steering: " + cars.map(car => car.hand_breaks))
                }
            }
        }
        
    })
}))
